import { deleteCookie, readCookie, writeCookie } from "../../platform/support/BrowserCookieSupport";

const RETURN_URL_COOKIE = "litellm_return_url";
const RETURN_URL_PARAM = "redirect_to";

export function getCurrentUrl(): string | null {
	return typeof window === "undefined" ? null : window.location.href;
}

export function storeReturnUrl(): void {
	const current = getCurrentUrl();
	if (current) writeCookie(RETURN_URL_COOKIE, current, 300);
}

export function getStoredReturnUrl(): string | null {
	return readCookie(RETURN_URL_COOKIE);
}
export function clearStoredReturnUrl(): void {
	deleteCookie(RETURN_URL_COOKIE);
}
export function getReturnUrlFromParams(): string | null {
	return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(RETURN_URL_PARAM);
}

export function buildLoginUrlWithReturn(baseLoginUrl: string, returnUrl?: string): string {
	const url = returnUrl || getCurrentUrl();
	if (!url || url.includes("/login")) return baseLoginUrl;
	return baseLoginUrl + (baseLoginUrl.includes("?") ? "&" : "?") + RETURN_URL_PARAM + "=" + encodeURIComponent(url);
}

export function getReturnUrl(): string | null {
	return getReturnUrlFromParams() || getStoredReturnUrl();
}

function isDevEnvironment(): boolean {
	if (typeof window === "undefined") return false;
	const hostname = window.location.hostname;
	return (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "::1" ||
		hostname.startsWith("127.") ||
		hostname.endsWith(".local")
	);
}

export function isValidReturnUrl(url: string): boolean {
	if (!url) return false;
	if (url.startsWith("/") && !url.startsWith("//")) return true;
	if (typeof window === "undefined") return false;
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== window.location.hostname) return false;
		return isDevEnvironment() || parsed.origin === window.location.origin;
	} catch {
		return false;
	}
}

export function normalizeUrlForCompare(url: string): string {
	if (typeof window === "undefined") return url;
	try {
		const parsed = new URL(url, window.location.origin);
		const pathname = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/$/, "") : parsed.pathname;
		const params = new URLSearchParams();
		Array.from(parsed.searchParams.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.forEach(([key, value]) => params.append(key, value));
		const search = params.toString();
		return parsed.origin + pathname + (search ? "?" + search : "") + parsed.hash;
	} catch {
		return url;
	}
}

export function consumeReturnUrl(): string | null {
	for (const candidate of [getReturnUrlFromParams(), getStoredReturnUrl()]) {
		if (candidate && isValidReturnUrl(candidate)) {
			clearStoredReturnUrl();
			return candidate;
		}
	}
	return null;
}
