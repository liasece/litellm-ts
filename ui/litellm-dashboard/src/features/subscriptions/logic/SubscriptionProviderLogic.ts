import { Providers, provider_map, subscription_provider_slugs } from "../../providers/data/ProviderCatalogData";

/** 第一方订阅 Provider 的公开 slug，与后端 SUBSCRIPTION_PROVIDERS 一致。 */
export const SUBSCRIPTION_PROVIDER_SLUGS = [
	subscription_provider_slugs.codex,
	subscription_provider_slugs.commandCode,
	subscription_provider_slugs.openCodeGo,
	subscription_provider_slugs.kimi,
	subscription_provider_slugs.claude,
	subscription_provider_slugs.antigravity,
	subscription_provider_slugs.xai,
] as const;

const subscriptionSlugs = new Set<string>(SUBSCRIPTION_PROVIDER_SLUGS);

/** 订阅 Provider 账号来源；账号页与会话登录使用同一份映射。 */
export const SUBSCRIPTION_PROVIDER_ACCOUNT_SOURCES: Readonly<Record<string, string>> = {
	[subscription_provider_slugs.codex]: "codex",
	[subscription_provider_slugs.commandCode]: "commandcode",
	[subscription_provider_slugs.openCodeGo]: "opencode-go",
	[subscription_provider_slugs.kimi]: "kimi",
	[subscription_provider_slugs.claude]: "claude",
	[subscription_provider_slugs.antigravity]: "antigravity",
	[subscription_provider_slugs.xai]: "xai",
};

/** 是否第一方订阅 Provider（公开 slug）。 */
export function isSubscriptionProviderSlug(value: unknown): boolean {
	return typeof value === "string" && subscriptionSlugs.has(value.trim().toLowerCase());
}

/**
 * 解析 Provider 选择值到公开 slug。
 * 目录接口发布 provider 名与 litellm_provider slug，两种输入都要能落到 slug。
 */
export function providerSlugFromValue(value: unknown): string {
	if (typeof value !== "string") return "";
	const raw = value.trim();
	if (!raw) return "";
	if (subscriptionSlugs.has(raw.toLowerCase())) return raw.toLowerCase();
	const byEnumName = Object.entries(Providers).find(([, name]) => name.toLowerCase() === raw.toLowerCase())?.[0];
	if (byEnumName && provider_map[byEnumName]) return provider_map[byEnumName];
	return provider_map[raw] ?? raw.toLowerCase();
}

/** Persist the upstream ID separately from its subscription account source. */
export function subscriptionModelName(providerSlug: string, upstreamId: string): string {
	const slug = providerSlug.trim().toLowerCase();
	const id = upstreamId.trim();
	return slug && id.toLowerCase().startsWith(slug + "/") ? id.slice(slug.length + 1) : id;
}

/** 模型页到订阅账号管理页的 URL（保持 dashboard 的 uiBase 与 legacy ?page= 路由）。 */
export function subscriptionAccountsHref(uiBase = "/ui", providerSlug = ""): string {
	const base = uiBase.replace(/\/+$/, "");
	const query = new URLSearchParams({ page: "subscriptions" });
	if (providerSlug) query.set("provider", providerSlug.trim().toLowerCase());
	return base + "/?" + query.toString();
}
