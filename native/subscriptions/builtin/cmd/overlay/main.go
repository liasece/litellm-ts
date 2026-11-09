// Command overlay prepares a small, reviewable patched copy of the pinned
// github.com/router-for-me/CLIProxyAPI/v8 v8.0.57 module so the plugin host
// can open statically linked first-party plugins in-process.
//
// Usage (from native/subscriptions, where go.mod pins v8.0.57):
//
//	go run ./builtin/cmd/overlay
//	go build -modfile=<printed builtin.mod> ./...
//
// Why a patched copy: `go build -overlay` refuses replacements whose target is
// beneath GOMODCACHE, and the upstream package lives there. The generator
// therefore copies the pinned module (about 37 MB) into a tool-owned temp
// directory, applies two exact single-anchor rewrites, adds one package file,
// and writes an alternate module file whose only extra directive is a replace
// pointing at the copy. Nothing in the module cache or in this repository is
// modified, and the diff against upstream stays reviewable:
//
//	internal/pluginhost/host.go       defaultPluginLoader() -> newDefaultLoader()
//	internal/pluginhost/platform.go   selectPluginFiles appends built-ins
//	internal/pluginhost/pluginhost_builtin.go   new file (see ../../overlay)
package main

import (
	"bytes"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const (
	modulePath      = "github.com/router-for-me/CLIProxyAPI/v8"
	requiredVersion = "v8.0.57"
	outputDirPrefix = "litellm-ts-builtin"
)

func main() {
	var (
		outDir       = flag.String("out", "", "output directory (default: <temp>/"+outputDirPrefix+")")
		allowVersion = flag.Bool("allow-other-version", false, "accept a CLIProxyAPI v8 version other than "+requiredVersion)
	)
	flag.Parse()
	if err := run(*outDir, *allowVersion); err != nil {
		fmt.Fprintln(os.Stderr, "overlay:", err)
		os.Exit(1)
	}
}

func run(outDir string, allowOtherVersion bool) error {
	moduleDir, version, err := resolveModule()
	if err != nil {
		return err
	}
	if !allowOtherVersion && version != requiredVersion {
		return fmt.Errorf("%s resolved to %s, want %s (anchors are verified against that tag)", modulePath, version, requiredVersion)
	}
	mainDir, err := os.Getwd()
	if err != nil {
		return err
	}
	mainMod := filepath.Join(mainDir, "go.mod")
	if _, err := os.Stat(mainMod); err != nil {
		return fmt.Errorf("run this from native/subscriptions (go.mod not found): %w", err)
	}
	if outDir == "" {
		outDir, err = os.MkdirTemp("", outputDirPrefix+"-")
		if err != nil {
			return err
		}
	}
	absOut, err := filepath.Abs(outDir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(absOut, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(absOut)
	if err != nil {
		return err
	}
	if len(entries) != 0 {
		return fmt.Errorf("build directory must be empty: %s", absOut)
	}

	patchedDir := filepath.Join(absOut, "cliproxyapi")
	if err := copyTree(moduleDir, patchedDir); err != nil {
		return fmt.Errorf("copy pinned module: %w", err)
	}

	pluginhostDir := filepath.Join(patchedDir, "internal", "pluginhost")
	if err := patchFile(filepath.Join(pluginhostDir, "host.go"), []replacement{{
		old: "defaultPluginLoader(),",
		new: "newDefaultLoader(),",
	}}); err != nil {
		return err
	}
	if err := patchFile(filepath.Join(pluginhostDir, "platform.go"), []replacement{{
		old: "func selectPluginFiles(root string, desiredVersions ...map[string]string) ([]pluginFile, error) {\n" +
			"\tselected, _, errSelect := selectPluginFilesWithCandidates(root, desiredVersions...)\n" +
			"\treturn selected, errSelect\n" +
			"}",
		new: "func selectPluginFiles(root string, desiredVersions ...map[string]string) ([]pluginFile, error) {\n" +
			"\tselected, _, errSelect := selectPluginFilesWithCandidates(root, desiredVersions...)\n" +
			"\tif errSelect != nil {\n" +
			"\t\treturn nil, errSelect\n" +
			"\t}\n" +
			"\treturn appendBuiltinPluginFiles(selected, desiredVersions...), nil\n" +
			"}",
	}}); err != nil {
		return err
	}

	// Archive records remain listable, while their on-disk token and status
	// are reserved for restoration rather than selection or refresh.
	if err := patchFile(filepath.Join(patchedDir, "sdk", "auth", "filestore.go"), []replacement{{
		old: "\t\tif len(auths) > 0 {\n\t\t\tentries = append(entries, auths...)",
		new: `		// LiteLLM keeps archived accounts visible to administrators until they
		// are restored. The on-disk flags describe the restored account; never
		// rewrite its token file or schedule refreshes while it is archived.
		if rel, err := filepath.Rel(dir, path); err == nil && strings.HasPrefix(filepath.ToSlash(rel), ".trash/") {
			for _, auth := range auths {
				if auth != nil {
					auth.Disabled = true
					auth.Status = cliproxyauth.StatusDisabled
				}
			}
		}
		if len(auths) > 0 {
			entries = append(entries, auths...)`,
	}}); err != nil {
		return err
	}
	// The public SDK accepts the router's decision per WebSocket turn. Extract
	// LiteLLM's authenticated source alongside the original frame, before the
	// SDK records it or forwards it to an executor.
	if err := patchFile(filepath.Join(patchedDir, "sdk", "api", "handlers", "openai", "openai_responses_websocket.go"), []replacement{
		{old: "\t\twsTimelineLog.BeginRequest()", new: `		turnParent := c.Request.Context()
		if callback, ok := c.Get("litellm.subscriptionTurn"); ok {
			if bind, ok := callback.(func(context.Context, []byte) (context.Context, []byte)); ok {
				turnParent, payload = bind(turnParent, payload)
			}
		}
		wsTimelineLog.BeginRequest()`},
		{old: `executionParent := context.WithValue(c.Request.Context(), "gin", c)`, new: `executionParent := context.WithValue(turnParent, "gin", c)`},
	}); err != nil {
		return err
	}
	templateDir, err := overlayTemplateDir()
	if err != nil {
		return err
	}
	for _, name := range []struct{ src, dst string }{
		{"pluginhost_builtin.go.tmpl", "pluginhost_builtin.go"},
		{"pluginhost_builtin_test.go.tmpl", "pluginhost_builtin_test.go"},
	} {
		raw, err := os.ReadFile(filepath.Join(templateDir, name.src))
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(pluginhostDir, name.dst), raw, 0o644); err != nil {
			return err
		}
	}

	altMod := filepath.Join(absOut, "builtin.mod")
	if err := copyFile(mainMod, altMod); err != nil {
		return err
	}
	if err := copyFile(strings.TrimSuffix(mainMod, ".mod")+".sum", filepath.Join(absOut, "builtin.sum")); err != nil {
		return err
	}
	appendText := fmt.Sprintf("\n// generated by native/subscriptions/builtin: run the pin-verified patched copy.\nreplace %s => %s\n", modulePath, patchedDir)
	if err := appendFile(altMod, appendText); err != nil {
		return err
	}

	fmt.Printf("CLIProxyAPI %s copied to %s\n", version, patchedDir)
	fmt.Printf("alternate module file %s\n", altMod)
	fmt.Printf("build with:\n  go build -modfile=%s ./...\n", altMod)
	fmt.Printf("test the host integration with:\n  go test -modfile=%s ./internal/pluginhost -run BuiltinPlugin\n", altMod)
	return nil
}

type replacement struct {
	old string
	new string
}

func patchFile(path string, replacements []replacement) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	patched := raw
	for _, item := range replacements {
		if count := bytes.Count(patched, []byte(item.old)); count != 1 {
			return fmt.Errorf("%s: anchor %q matched %d times, want exactly 1 (upstream drifted; pin %s)", path, firstLine(item.old), count, requiredVersion)
		}
		patched = bytes.Replace(patched, []byte(item.old), []byte(item.new), 1)
	}
	return os.WriteFile(path, patched, 0o644)
}

func firstLine(text string) string {
	if index := strings.IndexByte(text, '\n'); index >= 0 {
		return text[:index]
	}
	return text
}

func resolveModule() (string, string, error) {
	cmd := exec.Command("go", "list", "-m", "-f", "{{.Dir}}\t{{.Version}}", modulePath)
	cmd.Env = os.Environ()
	out, err := cmd.Output()
	if err != nil {
		return "", "", fmt.Errorf("resolve %s (run this from native/subscriptions): %w", modulePath, err)
	}
	fields := strings.Fields(strings.TrimSpace(string(out)))
	if len(fields) != 2 || fields[0] == "" {
		return "", "", fmt.Errorf("unexpected go list output %q", strings.TrimSpace(string(out)))
	}
	return fields[0], fields[1], nil
}

func overlayTemplateDir() (string, error) {
	if wd, err := os.Getwd(); err == nil {
		if dir, ok := locateTemplateDir(wd); ok {
			return dir, nil
		}
	}
	if exe, err := os.Executable(); err == nil {
		if dir, ok := locateTemplateDir(filepath.Dir(exe)); ok {
			return dir, nil
		}
	}
	return "", fmt.Errorf("cannot locate builtin/overlay templates")
}

func locateTemplateDir(dir string) (string, bool) {
	for i := 0; i < 6; i++ {
		candidate := filepath.Join(dir, "builtin", "overlay")
		if _, err := os.Stat(filepath.Join(candidate, "pluginhost_builtin.go.tmpl")); err == nil {
			return candidate, true
		}
		dir = filepath.Dir(dir)
	}
	return "", false
}

func copyTree(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		return copyFile(path, target)
	})
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		if os.IsNotExist(err) && strings.HasSuffix(src, ".sum") {
			return os.WriteFile(dst, nil, 0o644)
		}
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func appendFile(path, text string) error {
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err := file.WriteString(text); err != nil {
		file.Close()
		return err
	}
	return file.Close()
}
