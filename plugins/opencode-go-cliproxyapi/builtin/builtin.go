// Package builtin exposes the OpenCode Go plugin RPC dispatcher as an
// ordinary importable Go package.
//
// main.go keeps the c-shared cliproxy_plugin_init export for the traditional
// ".so built from source" upgrade path. This package is the same dispatcher
// reached in-process: the host passes one host-callback function and then
// exchanges the identical pluginabi envelopes over the same method set.
package builtin

import (
	"context"
	"fmt"

	"opencode-go-cliproxyapi/internal/plugin"

	"github.com/router-for-me/CLIProxyAPI/v8/sdk/pluginabi"
)

const (
	// PluginID is the plugin identity the CLIProxyAPI host registers and
	// exposes through plugins.configs, management and quota endpoints.
	PluginID = "opencode-go-cliproxyapi"
	// Version is the upstream release imported into this directory.
	Version = "0.2.2"
)

// HostCall performs one host RPC callback (host.http.do, host.log,
// host.auth.*, host.model.*, host.stream.*) and returns the raw RPC result.
// The built-in host binds the plugin identity and callback lifetime, so the
// plugin treats it exactly like the c-shared host.call function pointer.
type HostCall func(method string, request []byte) ([]byte, error)

// Dispatcher is the in-process equivalent of cliproxyPluginCall.
type Dispatcher struct {
	manager *plugin.Manager
}

// New builds a dispatcher whose outbound host traffic flows through hostCall.
// hostCall must be non-nil for providers that make upstream requests.
func New(hostCall HostCall) *Dispatcher {
	bridge := plugin.NewHostBridge(plugin.RawCaller(hostCall))
	return &Dispatcher{manager: plugin.NewManager(bridge)}
}

// Call handles one plugin RPC method. Error handling mirrors main.go: a
// dispatcher error is converted into a plugin_error envelope, which is what
// the c-shared export writes before returning rc=1.
func (d *Dispatcher) Call(_ context.Context, method string, request []byte) ([]byte, error) {
	if d == nil || d.manager == nil {
		return nil, fmt.Errorf("opencode-go builtin dispatcher is not initialized")
	}
	raw, err := d.manager.HandleCall(method, request)
	if err != nil {
		return plugin.ErrEnvelope("plugin_error", err.Error()), nil
	}
	return raw, nil
}

// Shutdown runs the plugin's own plugin.shutdown lifecycle (stops the
// catalog refresh ticker and drains host callbacks).
func (d *Dispatcher) Shutdown() {
	if d == nil || d.manager == nil {
		return
	}
	_, _ = d.manager.HandleCall(pluginabi.MethodPluginShutdown, nil)
}
