import { getProviderBrand, type ProviderBrand } from "../../providers/logic/ProviderBrands";
import {
	SUBSCRIPTION_PROVIDER_ACCOUNT_SOURCES,
	isSubscriptionProviderSlug,
	subscriptionAccountsHref,
} from "../../subscriptions/logic/SubscriptionProviderLogic";

/** 订阅类部署在 Credentials 列要展示的 Provider 身份。 */
export interface SubscriptionCredential {
	/** 订阅 Provider 的公开 slug（如 `codex-subscription`），用于链接到对应账号页。 */
	slug: string;
	brand: ProviderBrand;
	href: string;
}

/**
 * 订阅类部署不使用可复用 credential：账号、令牌刷新与额度都由订阅运行时持有，
 * `litellm_credential_name` 必然为空。直接显示 “Manual” 会让人以为要在这条部署上填密钥，
 * 所以这里把 provider slug 还原成品牌，链接指向该 Provider 的订阅账号页。
 *
 * @param provider 部署的 provider slug，通常是 `litellm_params.custom_llm_provider`
 * @param uiBase dashboard 的 `/ui` 前缀，用于拼账号页地址
 */
export function subscriptionCredential(provider: unknown, uiBase = "/ui"): SubscriptionCredential | null {
	const slug = typeof provider === "string" ? provider.trim().toLowerCase() : "";
	if (!isSubscriptionProviderSlug(slug)) return null;
	const brand = getProviderBrand(SUBSCRIPTION_PROVIDER_ACCOUNT_SOURCES[slug] ?? slug);
	return { slug, brand, href: subscriptionAccountsHref(uiBase, slug) };
}
