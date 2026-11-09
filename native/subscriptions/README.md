# LiteLLM subscription runtime

LiteLLM selects a deployment and its subscription provider. The private Go executable selects an eligible account in that provider and performs the protocol exchange. The HTTP, SSE and WebSocket handlers share one SDK scheduler and token store. The normal image runs `litellm-subscriptions`, built from this directory against the SDK pinned in `go.mod`. CommandCode comes from our fork and OpenCode Go from the pinned source under `plugins/`. The loader prefers the compiled implementations for the exact compatibility libraries shipped in the image. A third-party library or an operator replacement keeps the dynamic loader.

The dashboard exposes Codex, CommandCode, OpenCode Go, Kimi, Claude, Antigravity and xAI subscription providers. A deployment stores its public model name, its provider and its upstream model. Provider-specific model discovery only lists models registered by that source. Store and rotate new CommandCode/OpenCode API keys from Subscriptions. These keys are sealed with `LITELLM_SALT_KEY` or the gateway master key. Changing the encryption key requires migration with the previous key. Existing user YAML, environment-backed keys and OAuth account files retain their original format. OAuth token refresh has one writer. The gateway projects saved keys to mode-0600 files in the existing runtime volume.

Existing `cliproxy` model rows, IDs, public aliases, configuration and Logs can be used as stored. For each request, the gateway maps an old deployment to a subscription when the running registry gives it exactly one recognized source. Shared or missing registrations retain the compatibility resolver. To roll back one legacy deployment through the model editor or model API, set `litellm_params.subscription_transport` to `compatibility`. Remove it to rejoin native routing. Both paths share the current account state and neither replays the request. A surface marked `engine: subscriptions` on `/cliproxy/status` is the source-built runtime.

The current version link still records the operator's selection. Selecting an explicitly installed upstream release uses the compatibility runtime and the same account volume. Selecting the SDK version shipped by the image uses the source-built runtime. Switch through the gateway's update/rollback endpoints so active calls can drain. Never copy old refresh tokens back from a snapshot.

Build locally with a compatible Go toolchain and C compiler:

```sh
sh native/subscriptions/build.sh /tmp/litellm-subscriptions-output
node native/subscriptions/verify.mjs /tmp/litellm-subscriptions-output/litellm-subscriptions /tmp/litellm-subscriptions-output/plugins
```

The verifier uses a temporary account directory and a fake upstream. Add a third argument pointing to the baseline CLIProxyAPI v8.0.57 binary to compare both engines. `Dockerfile.runtime` builds the Linux artifacts for release.
