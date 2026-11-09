# Compiled subscription plugins

The host links the local CommandCode fork and OpenCode Go into `litellm-subscriptions`. Both register their normal RPC dispatchers with the SDK. The registered ID can include a configured plugin prefix. The native model name is the upstream ID used for subscription deployment configuration and discovery.

The build helper applies the pinned SDK integration to a temporary copy. The host loads operator-installed dynamic plugins through the SDK loader. A dynamic override with the same ID takes precedence over the built-in. See [the build and verification instructions](../README.md).
