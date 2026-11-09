package builtin

import (
	commandcodebuiltin "commandcode-go-cliproxyapi/builtin"
	opencodebuiltin "opencode-go-cliproxyapi/builtin"
)

// The two first-party subscription plugins are compiled into the host from
// their normal source trees (plugins/opencode-go-cliproxyapi imported at
// upstream v0.2.2, plugins/commandcode-go-cliproxyapi kept as this repo's
// fork). Their c-shared main.go files stay untouched for the traditional
// ".so built from source" upgrade path.
func init() {
	mustRegister(opencodebuiltin.PluginID, opencodebuiltin.Version, func(hostCall HostCall) Dispatcher {
		return opencodebuiltin.New(opencodebuiltin.HostCall(hostCall))
	})
	mustRegister(commandcodebuiltin.PluginID, commandcodebuiltin.Version, func(hostCall HostCall) Dispatcher {
		return commandcodebuiltin.New(commandcodebuiltin.HostCall(hostCall))
	})
}

func mustRegister(id, version string, factory Factory) {
	if err := Register(id, version, factory); err != nil {
		panic(err)
	}
}
