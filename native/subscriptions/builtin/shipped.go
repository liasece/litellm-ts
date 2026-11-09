package builtin

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"strings"
)

// ShippedLibrary recognizes our exact compatibility copy. Older CLIProxy
// releases need this file; our host uses its compiled implementation instead.
// Replacing the library through the plugin store gives the operator's build
// precedence. Only the two registered IDs are checked, at plugin discovery.
func ShippedLibrary(path string) bool {
	b, err := os.ReadFile(path + ".litellm-sha256")
	if err != nil {
		return false
	}
	want := strings.TrimSpace(string(b))
	if len(want) != sha256.Size*2 {
		return false
	}
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	sum := sha256.New()
	if _, err := io.Copy(sum, f); err != nil {
		return false
	}
	return hex.EncodeToString(sum.Sum(nil)) == want
}
