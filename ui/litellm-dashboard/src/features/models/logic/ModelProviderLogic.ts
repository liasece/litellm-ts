import { Providers, provider_map } from "../../providers/data/ProviderCatalogData";
import { isSubscriptionProviderSlug, providerSlugFromValue } from "../../subscriptions/logic/SubscriptionProviderLogic";
import type { UiSelectOption } from "../../platform/ui/UiTypes";
import type { ProviderMetadata } from "../support/ModelModels";
export function providerModels(provider: string, costs: Record<string, Record<string, unknown>>): string[] {
	const mapped = provider_map[provider],
		models = Object.entries(costs)
			.filter(
				([, info]) =>
					info.litellm_provider === mapped ||
					(typeof info.litellm_provider === "string" && info.litellm_provider.includes(mapped)),
			)
			.map(([name]) => name);
	if (provider === Providers.Cohere)
		models.push(
			...Object.entries(costs)
				.filter(([, info]) => info.litellm_provider === "cohere_chat")
				.map(([name]) => name),
		);
	if (provider === Providers.SageMaker)
		models.push(
			...Object.entries(costs)
				.filter(([, info]) => info.litellm_provider === "sagemaker_chat")
				.map(([name]) => name),
		);
	return models;
}

/**
 * Resolve the canonical provider slug from the published catalog.
 *
 * The catalog is authoritative: its `provider` label and `litellm_provider`
 * slug both select the same entry, so a backend relabel never changes routing.
 */
export function providerCatalogSlug(providers: readonly ProviderMetadata[], value: string): string {
	const metadata = providers.find((provider) => provider.provider === value || provider.litellm_provider === value);
	return metadata?.litellm_provider || providerSlugFromValue(value);
}

/** 是否兼容期通用 CLIProxy 目录项；新模型不再从它创建。 */
export function isGenericCliProxyProvider(provider: ProviderMetadata): boolean {
	return provider.litellm_provider === provider_map[Providers.CLIProxy] || provider.provider === Providers.CLIProxy;
}

/**
 * Provider 下拉候选项。
 *
 * 订阅 Provider 单独成组；通用 CLIProxy 只在该模型当前就使用它时保留，避免新模型
 * 继续选择兼容期入口，同时不破坏旧 deployment 的查看与编辑。
 */
export function providerSelectOptions(
	providers: readonly ProviderMetadata[],
	valueField: "provider" | "litellm_provider",
	modelValue: string | null,
): UiSelectOption[] {
	const unique = new Map<string, ProviderMetadata>();
	for (const provider of providers) {
		const key = provider[valueField];
		if (!key || unique.has(key)) continue;
		if (isGenericCliProxyProvider(provider) && key !== modelValue) continue;
		unique.set(key, provider);
	}
	const entries = [...unique.values()],
		optionValue = (provider: ProviderMetadata) => provider[valueField] || provider.provider,
		subscription = entries
			.filter((provider) => isSubscriptionProviderSlug(provider.litellm_provider))
			.sort((a, b) => a.provider_display_name.localeCompare(b.provider_display_name)),
		managed = entries.filter(isGenericCliProxyProvider),
		regular = entries.filter((provider) => !subscription.includes(provider) && !managed.includes(provider)),
		popular = ["Anthropic", "OpenAI"].flatMap((key) => regular.filter((provider) => provider.provider === key)),
		popularValues = new Set(popular.map(optionValue)),
		others = regular
			.filter((provider) => !popularValues.has(optionValue(provider)))
			.sort((a, b) => a.provider_display_name.localeCompare(b.provider_display_name)),
		toOption = (provider: ProviderMetadata, group: string): UiSelectOption => ({
			value: optionValue(provider),
			label: provider.provider_display_name,
			group,
		}),
		output = [
			...popular.map((provider) => toOption(provider, "Popular")),
			...subscription.map((provider) => toOption(provider, "Subscriptions")),
			...others.map((provider) => toOption(provider, "All Providers")),
			...managed.map((provider) => toOption(provider, "Legacy")),
		];
	if (modelValue && !unique.has(modelValue)) output.push({ value: modelValue, label: modelValue, group: "All Providers" });
	return output;
}

export const getPlaceholder = (selectedProvider: string): string => {
	if (isSubscriptionProviderSlug(providerSlugFromValue(selectedProvider))) {
		return "Enter an upstream model id from the subscription catalog";
	} else if (selectedProvider === Providers.CLIProxy) {
		return "Select a model from the managed CLIProxy runtime";
	} else if (selectedProvider === Providers.AIML) {
		return "aiml/flux-pro/v1.1";
	} else if (selectedProvider === Providers.Vertex_AI) {
		return "gemini-pro";
	} else if (selectedProvider == Providers.Anthropic) {
		return "claude-3-opus";
	} else if (selectedProvider == Providers.Bedrock) {
		return "claude-3-opus";
	} else if (selectedProvider == Providers.SageMaker) {
		return "sagemaker/jumpstart-dft-meta-textgeneration-llama-2-7b";
	} else if (selectedProvider == Providers.Google_AI_Studio) {
		return "gemini-pro";
	} else if (selectedProvider == Providers.Azure_AI_Studio) {
		return "azure_ai/command-r-plus";
	} else if (selectedProvider == Providers.Azure) {
		return "my-deployment";
	} else if (selectedProvider == Providers.Oracle) {
		return "oci/xai.grok-4";
	} else if (selectedProvider == Providers.Snowflake) {
		return "snowflake/mistral-7b";
	} else if (selectedProvider == Providers.Voyage) {
		return "voyage/";
	} else if (selectedProvider == Providers.JinaAI) {
		return "jina_ai/";
	} else if (selectedProvider == Providers.VolcEngine) {
		return "volcengine/<any-model-on-volcengine>";
	} else if (selectedProvider == Providers.DeepInfra) {
		return "deepinfra/<any-model-on-deepinfra>";
	} else if (selectedProvider == Providers.FalAI) {
		return "fal_ai/fal-ai/flux-pro/v1.1-ultra";
	} else if (selectedProvider == Providers.RunwayML) {
		return "runwayml/gen4_turbo";
	} else if (selectedProvider === Providers.WATSONX) {
		return "watsonx/ibm/granite-3-3-8b-instruct";
	} else if (selectedProvider === Providers.Cursor) {
		return "cursor/claude-4-sonnet";
	} else {
		return "gpt-3.5-turbo";
	}
};
