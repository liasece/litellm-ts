import { Providers, provider_map } from "../../providers/data/ProviderCatalogData";
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

export const getPlaceholder = (selectedProvider: string): string => {
	if (selectedProvider === Providers.CLIProxy) {
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
