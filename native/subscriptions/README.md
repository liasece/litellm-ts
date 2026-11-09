# Subscription runtime

LiteLLM selects the public deployment and its subscription provider. The private `litellm-subscriptions` worker selects an eligible account and performs the protocol exchange. The image builds the worker from the SDK pinned in `go.mod` and links both plugin implementations from `plugins/`. HTTP, SSE and WebSocket share the same token store and scheduler. Third-party dynamic plugins use the configured plugin directory.

## Model configuration

| Public alias | `custom_llm_provider` | `litellm_params.model` |
| --- | --- | --- |
| team-coder | commandcode | deepseek/deepseek-v4.1-flash |
| team-fast | opencode-go | deepseek-v4.1-flash |
| code-review | codex-subscription | gpt-6-luna |

Provider-qualified HTTP routes and per-turn WebSocket metadata select the account source independently of the upstream model name. The subscription catalog exposes native IDs even when a plugin registers a prefixed ID with the SDK.

Migration 0014 converts stored subscription deployments in place. It preserves public aliases, deployment IDs, overrides and historical billing records. The deployment preflight runs the migration's read-only source resolution before the container switch. An unrecognized or ambiguous old model requires an explicit subscription choice. Historical price and privacy rules retain their original scope. Roll back application code using an image that accepts the canonical model schema and contains the registered migration.

Use **Subscriptions** for accounts and **Manage runtime** for configuration, process logs, plugin administration and process controls. Runtime versions ship with application images. Older administrative clients can reach these same handlers through their original management URLs. OAuth files and archived accounts retain their existing locations. New managed keys are sealed with the configured salt or gateway master key.

## Verification

Build with a compatible Go toolchain and C compiler.

```sh
sh native/subscriptions/build.sh /tmp/subscription-runtime
node native/subscriptions/verify.mjs /tmp/subscription-runtime/litellm-subscriptions
```

The verifier uses synthetic accounts and a local upstream. To compare with the original release, pass a directory containing the reference plugin libraries and the baseline executable as the second and third arguments.
