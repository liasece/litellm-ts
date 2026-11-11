import { isModelFamily, resolveModelFamily, type ModelFamily } from "../../../../../../src/shared/ModelFamily";
import { Providers, provider_map, providerLogoMap, subscription_provider_slugs } from "../data/ProviderCatalogData";
import { getServerRootPath } from "../../platform/support/ApiEnvironmentSupport";
export { Providers, provider_map, providerLogoMap } from "../data/ProviderCatalogData";

export function resolveProviderLogo(url: string | undefined): string {
	if (!url) return "";
	if (!url.startsWith("/ui/")) return url;
	return getServerRootPath().replace(/\/+$/, "") + url;
}

const directProviderBrands: Record<string, { displayName: string; asset: string }> = {
	glm: { displayName: "Z.ai", asset: "zai.svg" },
	zai: { displayName: "Z.ai", asset: "zai.svg" },
	mimo: { displayName: "Xiaomi MiMo", asset: "mimo.svg" },
	"mimo-global": { displayName: "Xiaomi MiMo Global", asset: "mimo.svg" },
};

export const getProviderLogoAndName = (providerValue: string): { logo: string; displayName: string } => {
	if (!providerValue) {
		return { logo: "", displayName: "-" };
	}

	const direct = Object.hasOwn(directProviderBrands, providerValue.toLowerCase())
		? directProviderBrands[providerValue.toLowerCase()]
		: undefined;
	if (direct) return { logo: resolveProviderLogo("/ui/assets/logos/" + direct.asset), displayName: direct.displayName };

	// Persisted historical logs may still carry the retired provider name.
	if (providerValue.toLowerCase() === "cliproxy") return { logo: "", displayName: "CLIProxy" };

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

const familyAssets: Record<ModelFamily, string> = {
	"OpenAI": "openai_small.svg",
	"Claude": "claude.svg",
	"DeepSeek": "deepseek.svg",
	"Kimi": "kimi.svg",
	"Gemini": "gemini.svg",
	"Gemma": "gemma.svg",
	"Google": "google.svg",
	"Grok": "grok.svg",
	"MiniMax": "minimax.svg",
	"Qwen": "qwen.png",
	"GLM": "glm.svg",
	"Llama": "meta_llama.svg",
	"Mistral": "mistral.svg",
	"Cohere": "cohere.svg",
	"Amazon": "aws.svg",
	"Perplexity": "perplexity-ai.svg",
	"MiMo": "mimo.svg",
};

const subscriptionProviders = new Set<string>(Object.values(subscription_provider_slugs));

export function modelSupplier(model: string, provider?: string | null): string {
	const supplier = provider?.trim() ?? "";
	if (supplier.toLowerCase() === "cliproxy") {
		const segments = model.trim().toLowerCase().split("/");
		const prefix = segments[0] === "cliproxy" ? segments[1] : segments[0];
		return prefix && subscriptionProviders.has(prefix) ? prefix : "";
	}
	return supplier === "-" ? "" : supplier;
}

/**
 * 从模型串自带的 provider 段推断图标供应商。
 *
 * 展示位常常只有模型名、没有 provider 字段（路由链、限额列表、模型别名等）。只识别
 * 明确的订阅 provider 前缀（cliproxy/commandcode/... 或 commandcode/...），避免把任意
 * 模型命名空间误标成供应商。
 * @param model - 模型名，可能带 cliproxy/ 或 provider 前缀
 */
export function modelProviderHint(model: string): string {
	const segments = model.trim().toLowerCase().split("/");
	const prefix = segments[0] === "cliproxy" ? segments[1] : segments[0];
	return prefix && subscriptionProviders.has(prefix) ? prefix : "";
}

export function getModelIconIdentity(model: string, provider?: string | null, baseModel?: string, groupFamily?: string | null) {
	const family = groupFamily === undefined ? resolveModelFamily(model, baseModel) : isModelFamily(groupFamily) ? groupFamily : undefined;
	const supplier = modelSupplier(model, provider);
	return {
		family: family ? { displayName: family, logo: resolveProviderLogo("/ui/assets/logos/" + familyAssets[family]) } : null,
		supplier: supplier ? getProviderLogoAndName(supplier) : null,
	};
}
