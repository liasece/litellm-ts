import { Providers, provider_map, providerLogoMap } from "../data/ProviderCatalogData";
import { getServerRootPath } from "../../platform/support/ApiEnvironmentSupport";
export { Providers, provider_map, providerLogoMap } from "../data/ProviderCatalogData";

export function resolveProviderLogo(url: string | undefined): string {
	if (!url) return "";
	if (!url.startsWith("/ui/")) return url;
	return getServerRootPath().replace(/\/+$/, "") + url;
}

export const getProviderLogoAndName = (providerValue: string): { logo: string; displayName: string } => {
	if (!providerValue) {
		return { logo: "", displayName: "-" };
	}

	// Handle special case for "gemini" provider value
	if (providerValue.toLowerCase() === "gemini") {
		const displayName = Providers.Google_AI_Studio;
		const logo = resolveProviderLogo(providerLogoMap[displayName]);
		return { logo, displayName };
	}

	// Find the enum key by matching provider_map values
	const enumKey = Object.keys(provider_map).find((key) => provider_map[key].toLowerCase() === providerValue.toLowerCase());

	if (!enumKey) {
		return { logo: "", displayName: providerValue };
	}

	// Get the display name from Providers enum and logo from map
	const displayName = Providers[enumKey as keyof typeof Providers];
	const logo = resolveProviderLogo(providerLogoMap[displayName as keyof typeof providerLogoMap]);

	return { logo, displayName };
};

const MODEL_FAMILY_PROVIDER_RULES: ReadonlyArray<{
	provider: string;
	pattern: RegExp;
}> = [
	{ provider: "openai", pattern: /^(?:gpt|chatgpt|codex|o[1-9])(?:[-_.:]|$)/ },
	{ provider: "moonshot", pattern: /^(?:kimi|moonshot)(?:[-_.:]|$)/ },
	{ provider: "anthropic", pattern: /^claude(?:[-_.:]|$)/ },
	{ provider: "gemini", pattern: /^(?:gemini|imagen|veo)(?:[-_.:]|$)/ },
	{ provider: "xai", pattern: /^(?:grok|xai)(?:[-_.:]|$)/ },
	{ provider: "deepseek", pattern: /^deepseek(?:[-_.:]|$)/ },
	{ provider: "minimax", pattern: /^minimax(?:[-_.:]|$)/ },
	{ provider: "dashscope", pattern: /^(?:qwen|qwq|wan)(?:[0-9]|[-_.:]|$)/ },
	{ provider: "meta_llama", pattern: /^llama(?:[0-9]|[-_.:]|$)/ },
	{ provider: "mistral", pattern: /^(?:mistral|mixtral|codestral)(?:[0-9]|[-_.:]|$)/ },
	{ provider: "cohere", pattern: /^(?:command|embed-(?:english|multilingual))(?:[-_.:]|$)/ },
	{ provider: "bedrock", pattern: /^(?:amazon-)?(?:nova|titan)(?:[-_.:]|$)/ },
];

function normalizedModelFamilyName(modelValue: string): string {
	let value = modelValue.trim().toLowerCase();
	while (value.startsWith("models/") || value.startsWith("cliproxy/")) {
		value = value.slice(value.indexOf("/") + 1);
	}
	const slashIndex = value.lastIndexOf("/");
	return slashIndex >= 0 ? value.slice(slashIndex + 1) : value;
}

/**
 * Resolve the model vendor independently from its transport provider.
 *
 * CLIProxy is a routing layer, so a `cliproxy/gpt-*` deployment should use
 * OpenAI branding while a `cliproxy/kimi-*` deployment should use Moonshot
 * branding. Provider-specific routes keep their configured provider branding.
 */
export const getModelProvider = (providerValue: string | null | undefined, modelValue: string): string => {
	const provider = providerValue?.trim().toLowerCase() ?? "";
	if (provider && provider !== provider_map.CLIProxy) {
		return provider;
	}

	const modelFamilyName = normalizedModelFamilyName(modelValue);
	const inferred = MODEL_FAMILY_PROVIDER_RULES.find((rule) => rule.pattern.test(modelFamilyName))?.provider;
	if (inferred) {
		return inferred;
	}

	if (!provider) {
		const modelPrefix = modelValue.trim().toLowerCase().split("/")[0] ?? "";
		if (Object.values(provider_map).some((value) => value.toLowerCase() === modelPrefix)) {
			return modelPrefix;
		}
	}
	return provider;
};

export const getModelLogoAndName = (
	providerValue: string | null | undefined,
	modelValue: string,
): { logo: string; displayName: string; provider: string } => {
	const provider = getModelProvider(providerValue, modelValue);
	const { logo, displayName } = getProviderLogoAndName(provider);
	return { logo, displayName, provider };
};
