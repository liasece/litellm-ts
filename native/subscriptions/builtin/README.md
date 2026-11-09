# Compiled subscription plugins

The OpenCode Go v0.2.2 source and the local CommandCode v0.1.3 fork export their existing RPC dispatchers through their respective `builtin` packages. The application links both into its subscription executable. Account selection, host callbacks, streaming, quota and plugin lifecycle use the same SDK interfaces as dynamic plugins.

Run `sh native/subscriptions/build.sh <output>` from the repository root. The build tool copies the pinned SDK module to a temporary build directory and adds a small loader and discovery extension. It validates both source replacement points before compilation. The original module cache is read-only. The runtime image also includes the two ABI-compatible libraries for administrators who select older upstream releases. The SHA-256 markers identify the exact shipped copies. An installed override or third-party plugin uses the SDK's regular dynamic loader.

See [the runtime build and verification instructions](../README.md) and [the OpenCode Go source](../../../plugins/opencode-go-cliproxyapi/UPSTREAM.md).
