//go:build builtinhost

package builtin_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v8/sdk/pluginhost"
	"gopkg.in/yaml.v3"

	_ "github.com/jtllab/litellm-ts/subscriptions/builtin"
)

// TestBuiltInPluginsLoadThroughSDKHost pins the real host path: with no .so on
// disk, an enabled plugins.configs entry must still produce a registered
// plugin through the unmodified ApplyConfig/plugin.register/quota adapters.
// Run it against the patched host (see README):
//
//	go test -tags builtinhost -modfile=$TMPDIR/litellm-ts-builtin/builtin.mod \
//	  ./builtin -run TestBuiltInPluginsLoadThroughSDKHost
func TestBuiltInPluginsLoadThroughSDKHost(t *testing.T) {
	root := t.TempDir()
	authDir := filepath.Join(root, "auths")
	if err := os.MkdirAll(authDir, 0o755); err != nil {
		t.Fatal(err)
	}
	pluginDir := filepath.Join(root, "plugins")

	host := pluginhost.New()
	host.ApplyConfig(context.Background(), pluginhost.RuntimeConfig{
		Enabled: true,
		Dir:     pluginDir,
		AuthDir: authDir,
		Configs: map[string]pluginhost.PluginInstanceConfig{
			"opencode-go-cliproxyapi": pluginInstance(t, "enabled: true\n"+
				"api-keys:\n  - name: Regression\n    value: regression-key\n"),
			"commandcode-go-cliproxyapi": pluginInstance(t, "enabled: true\n"),
		},
	})
	defer host.ShutdownAll()

	registered := map[string]bool{}
	for _, plugin := range host.RegisteredPlugins() {
		registered[plugin.ID] = true
	}
	for _, id := range []string{"opencode-go-cliproxyapi", "commandcode-go-cliproxyapi"} {
		if !registered[id] {
			t.Fatalf("built-in plugin %s did not register through the SDK host; registered=%v", id, registered)
		}
	}
}

func pluginInstance(t *testing.T, raw string) pluginhost.PluginInstanceConfig {
	t.Helper()
	var document yaml.Node
	if err := yaml.Unmarshal([]byte(raw), &document); err != nil {
		t.Fatal(err)
	}
	if len(document.Content) != 1 {
		t.Fatalf("unexpected yaml document shape for %q", raw)
	}
	enabled := true
	return pluginhost.PluginInstanceConfig{Enabled: &enabled, Raw: *document.Content[0]}
}
