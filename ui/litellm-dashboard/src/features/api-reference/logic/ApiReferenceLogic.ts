export const PROXY_URL_PLACEHOLDER = "__LITELLM_PROXY_URL__";
export function apiReferenceBaseUrl(settings: Record<string, unknown>): string {
	const custom = settings.LITELLM_UI_API_DOC_BASE_URL,
		base = settings.PROXY_BASE_URL;
	return typeof custom === "string" && custom.trim() ? custom : typeof base === "string" && base ? base : "<your_proxy_base_url>";
}
export function substituteProxyUrl(value: string, baseUrl: string): string {
	return value.replaceAll(PROXY_URL_PLACEHOLDER, baseUrl);
}
