// Package builtin makes the first-party subscription plugins (OpenCode Go and
// CommandCode) available to the CLIProxyAPI plugin host as statically linked
// implementations instead of release .so artifacts.
//
// The plugin packages keep their normal RPC dispatcher (the same code the
// c-shared export runs). This package only records the plugin identity and a
// constructor; the host-side loader injected by the build overlay in
// overlay/pluginhost_builtin.go.tmpl turns that into a pluginClient, so
// registration, capabilities, management routes, quota, auth refresh and
// streaming all keep flowing through the unmodified pluginhost code paths.
package builtin

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
)

// HostCall performs one host RPC callback (host.http.do, host.log,
// host.auth.*, host.model.*, host.stream.*) on behalf of one plugin instance.
type HostCall func(method string, request []byte) ([]byte, error)

// Dispatcher is the in-process form of the c-shared plugin function table.
// Call must behave like cliproxyPluginCall and Shutdown like
// cliproxyPluginShutdown.
type Dispatcher interface {
	Call(ctx context.Context, method string, request []byte) ([]byte, error)
	Shutdown()
}

// Factory builds a dispatcher bound to the supplied host callback.
type Factory func(hostCall HostCall) Dispatcher

// Entry describes one registered built-in plugin.
type Entry struct {
	ID      string
	Version string
}

type registration struct {
	version string
	factory Factory
}

var registry = struct {
	sync.RWMutex
	entries map[string]registration
}{entries: make(map[string]registration)}

// Register adds one built-in plugin. Re-registering the same id with an
// identical version/factory presence is a no-op; conflicting registrations
// return an error so a wiring mistake cannot silently shadow a plugin.
func Register(id, version string, factory Factory) error {
	id = strings.TrimSpace(id)
	version = strings.TrimSpace(version)
	if id == "" {
		return fmt.Errorf("builtin: plugin id is required")
	}
	if factory == nil {
		return fmt.Errorf("builtin: factory for %s is required", id)
	}
	if version == "" {
		return fmt.Errorf("builtin: version for %s is required", id)
	}
	registry.Lock()
	defer registry.Unlock()
	if existing, ok := registry.entries[id]; ok {
		if existing.version != version {
			return fmt.Errorf("builtin: plugin %s already registered at %s (want %s)", id, existing.version, version)
		}
		return nil
	}
	registry.entries[id] = registration{version: version, factory: factory}
	return nil
}

// Plugins returns every registered built-in plugin sorted by id.
func Plugins() []Entry {
	registry.RLock()
	defer registry.RUnlock()
	out := make([]Entry, 0, len(registry.entries))
	for id, item := range registry.entries {
		out = append(out, Entry{ID: id, Version: item.version})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Lookup reports whether id is a registered built-in plugin and its version.
func Lookup(id string) (string, bool) {
	registry.RLock()
	defer registry.RUnlock()
	item, ok := registry.entries[strings.TrimSpace(id)]
	return item.version, ok
}

// Open builds the in-process dispatcher for id. The second result reports
// whether id is registered at all; err reports a construction failure.
func Open(id string, hostCall HostCall) (Dispatcher, bool, error) {
	registry.RLock()
	item, ok := registry.entries[strings.TrimSpace(id)]
	registry.RUnlock()
	if !ok {
		return nil, false, nil
	}
	if hostCall == nil {
		return nil, true, fmt.Errorf("builtin: host callback for %s is required", id)
	}
	dispatcher := item.factory(hostCall)
	if dispatcher == nil {
		return nil, true, fmt.Errorf("builtin: factory for %s returned nil", id)
	}
	return dispatcher, true, nil
}
