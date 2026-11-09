# Upstream provenance

This directory is the upstream source of
[massiveits/opencode-go-cliproxyapi](https://github.com/massiveits/opencode-go-cliproxyapi)
imported at tag **v0.2.2** (module `opencode-go-cliproxyapi`, `pluginVersion = "0.2.2"`).

The upstream `LICENSE` is kept verbatim: MIT, Copyright (c) 2026 massiveits.
Upstream README, `main.go` and `tests/` are imported verbatim;
packaging artifacts (release zips, CI workflows, changelog files) are not
included.

The model catalog also sets the SDK’s provider-native `Name` to the upstream model ID so account routing prefixes stay out of LiteLLM configuration. The local `builtin/` directory is a thin package that exposes the same
RPC dispatcher `main.go` runs behind the c-shared export
(`cliproxy_plugin_init` / `cliproxyPluginCall`) as an importable Go entry
point. `main.go` remains the supported way to build the standalone `.so` for
the traditional upgrade path.

Do not point releases at this copy; it is compiled into the LiteLLM TS Go host
and also serves as the source for a from-source `.so` build.
