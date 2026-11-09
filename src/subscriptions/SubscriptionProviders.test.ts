import { DEFAULT_PRIVACY_MASKING_SETTINGS } from "../privacy/PrivacyConfig";
import { LlmProviders } from "../types/provider";
import { ProviderRegistry } from "../providers/ProviderRegistry";
import { adjustCost } from "../cost/CostTrackingConfig";
import { isPrivacyScopeMatch } from "../privacy/PrivacyScope";
import { subscriptionModelParams } from "./SubscriptionProviders";

const registry = new ProviderRegistry({ baseUrl: "http://127.0.0.1:8317", internalApiKey: "fixture" });

it("stores only the upstream ID and addresses the configured subscription when multiple sources publish it", () => {
	for (const source of [LlmProviders.CommandCode, LlmProviders.OpenCodeGo]) {
		const params = subscriptionModelParams({ model: source + "/vendor/model", custom_llm_provider: source, api_key: "fixture" });
		expect(params).toEqual({ model: "vendor/model", custom_llm_provider: source });
		const request = registry.getProvider("vendor/model", source).transformRequest("vendor/model", [], {});
		expect(request.url).toBe("http://127.0.0.1:8317/subscriptions/" + source + "/v1/chat/completions");
		expect(request.body).toMatchObject({ model: "vendor/model" });
	}
});

it("rejects retired deployment configuration without offering generic execution", () => {
	expect(() => subscriptionModelParams({ model: "cliproxy/vendor/model" })).toThrow();
	expect(() => subscriptionModelParams({ model: "vendor/model", custom_llm_provider: "cliproxy" })).toThrow();
	expect(() => registry.getProvider("cliproxy/vendor/model")).toThrow(/Unknown provider/);
	expect(() =>
		subscriptionModelParams({ model: "vendor/model", custom_llm_provider: "commandcode", subscription_transport: "compatibility" }),
	).toThrow();
});

it("inherits existing discount, margin and privacy rules and gives explicit subscription pricing precedence", () => {
	expect(adjustCost(10, LlmProviders.CodexSubscription, { discount: { cliproxy: 0.5 }, margin: { cliproxy: 0.2 } }).total).toBe(6);
	expect(
		adjustCost(10, LlmProviders.CodexSubscription, {
			discount: { cliproxy: 0.5, "codex-subscription": 0 },
			margin: { cliproxy: 0.2 },
		}).total,
	).toBe(12);
	const settings = { ...DEFAULT_PRIVACY_MASKING_SETTINGS, providers: ["cliproxy"], models: ["cliproxy/gpt-model"] };
	expect(
		isPrivacyScopeMatch(settings, {
			provider: "codex-subscription",
			modelName: "my-public-alias",
			upstreamModel: "codex-subscription/gpt-model",
		}),
	).toBe(true);
});
