import { DEFAULT_PRIVACY_MASKING_SETTINGS } from "../privacy/PrivacyConfig";
import { LlmProviders } from "../types/provider";
import type { Deployment } from "../types/router";
import { ProviderRegistry } from "../providers/ProviderRegistry";
import { adjustCost } from "../cost/CostTrackingConfig";
import { isPrivacyScopeMatch } from "../privacy/PrivacyScope";
import { SubscriptionCatalog } from "./SubscriptionProviders";

const catalog = new SubscriptionCatalog();
catalog.replace([
	{ id: "gpt-model", providers: ["codex"] },
	{ id: "commandcode/vendor/model", providers: ["commandcode"] },
	{ id: "custom/catalog-id", providers: ["commandcode"] },
	{ id: "shared", providers: ["codex", "another-plugin"] },
]);
const registry = new ProviderRegistry({
	baseUrl: "http://127.0.0.1:8317",
	internalApiKey: "local-test-ingress",
	sourceBuiltSubscriptions: true,
	subscriptionCatalog: catalog,
});
function legacy(model: string): Deployment {
	return {
		model_name: "my-public-alias",
		model_info: { id: "original-deployment" },
		litellm_params: { model, custom_llm_provider: "cliproxy" },
	};
}

it("routes an existing deployment to its registered subscription, keeping its billing model and public ID", () => {
	const original = legacy("cliproxy/commandcode/vendor/model");
	const deployment = catalog.deployment(original);
	expect(deployment.litellm_params).toEqual({ model: original.litellm_params.model, custom_llm_provider: "commandcode" });
	expect(deployment.model_info?.id).toBe("original-deployment");
	expect(deployment.model_name).toBe("my-public-alias");
	const params = deployment.litellm_params;
	const request = registry.getProvider(params.model, params.custom_llm_provider).transformResponsesRequest!(
		params.model,
		{ input: "test", tools: [{ type: "web_search" }] },
		{},
	);
	expect(request?.url).toBe("http://127.0.0.1:8317/subscriptions/commandcode/v1/responses");
	expect(request?.body).toMatchObject({ model: "commandcode/vendor/model", tools: [{ type: "web_search" }] });
	expect(original.litellm_params.custom_llm_provider).toBe("cliproxy");
});

it("keeps ambiguous or unregistered legacy models on their existing resolver and honors an explicitly selected subscription", () => {
	for (const model of ["shared", "unknown"]) {
		const deployment = legacy("cliproxy/" + model);
		expect(catalog.deployment(deployment)).toBe(deployment);
	}
	const request = registry.getProvider("codex-subscription/shared").transformRequest("codex-subscription/shared", [], {});
	expect(request.url).toContain("/subscriptions/codex-subscription/");
	expect(request.body).toMatchObject({ model: "shared" });
	const custom = registry.getProvider("commandcode/custom/catalog-id").transformRequest("commandcode/custom/catalog-id", [], {});
	expect(custom.body).toMatchObject({ model: "custom/catalog-id" });
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
