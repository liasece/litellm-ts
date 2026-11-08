import { HttpApiError } from "../support/HttpApiErrorSupport";
export { HttpApiError } from "../support/HttpApiErrorSupport";
import { getApiBaseUrl, getCsrfToken } from "../support/ApiEnvironmentSupport";

export { getApiBaseUrl, getServerRootPath, switchToWorkerUrl } from "../support/ApiEnvironmentSupport";

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const WEB_UI_COOKIE_SESSION_SENTINEL = "cookie-session";

export function deriveErrorMessage(payload: unknown): string {
	if (payload && typeof payload === "object") {
		const value = payload as Record<string, unknown>;
		const error = value.error;
		if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") {
			return (error as { message: string }).message;
		}
		if (typeof error === "string" && error) return error;
		if (typeof value.message === "string" && value.message) return value.message;
		const detail = value.detail;
		if (Array.isArray(detail))
			return detail
				.map((item: unknown) => {
					if (item && typeof item === "object" && typeof (item as Record<string, unknown>).msg === "string") {
						return (item as { msg: string }).msg;
					}
					return JSON.stringify(item);
				})
				.join("; ");
		if (typeof detail === "string" && detail) return detail;
	}
	return JSON.stringify(payload) ?? "An unexpected error occurred.";
}

/** Cookie-authenticated Dashboard requests carry CSRF only for writes. */
export async function dashboardFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
	const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
	const headers = new Headers(request?.headers);
	new Headers(init.headers).forEach((value, name) => headers.set(name, value));
	if (Array.from(headers.values()).some((value) => value.startsWith("Bearer "))) {
		return globalThis.fetch(input, init);
	}
	const method = (init.method ?? request?.method ?? "GET").toUpperCase();
	if (!SAFE_HTTP_METHODS.has(method)) {
		const csrfToken = getCsrfToken();
		if (csrfToken) headers.set("x-litellm-csrf-token", csrfToken);
	}
	return globalThis.fetch(input, { ...init, headers, credentials: "include" });
}

export async function requestJson<T = unknown>(path: string, init: RequestInit = {}, parse?: (payload: unknown) => T): Promise<T> {
	const url = /^https?:\/\//.test(path) ? path : getApiBaseUrl() + (path.startsWith("/") ? path : "/" + path);
	const headers = new Headers(init.headers);
	if (typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
	const response = await dashboardFetch(url, { ...init, headers });
	const payload: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
	if (!response.ok) throw new HttpApiError(deriveErrorMessage(payload), response.status);
	return parse ? parse(payload) : (payload as T);
}

export type PlaygroundAuth = { readonly kind: "session" } | { readonly kind: "virtual-key"; readonly apiKey: string };
export type PlaygroundProtocol = "openai" | "anthropic";

export function createPlaygroundFetch(auth: PlaygroundAuth, protocol: PlaygroundProtocol): typeof globalThis.fetch {
	return async (input, init = {}) => {
		const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
		const headers = new Headers(request?.headers);
		new Headers(init.headers).forEach((value, name) => headers.set(name, value));
		if (auth.kind === "session") {
			headers.delete("Authorization");
			headers.delete("x-api-key");
		} else if (protocol === "openai") {
			headers.set("Authorization", "Bearer " + auth.apiKey);
			headers.delete("x-api-key");
		} else {
			headers.set("x-api-key", auth.apiKey);
			headers.delete("Authorization");
		}
		if (auth.kind === "virtual-key")
			return globalThis.fetch(input, {
				...init,
				method: init.method ?? request?.method,
				signal: init.signal ?? request?.signal,
				headers,
				credentials: "omit",
			});
		return dashboardFetch(input, { ...init, method: init.method ?? request?.method, signal: init.signal ?? request?.signal, headers });
	};
}

export function buildWebSocketCredentialProtocols(accessToken: string | null | undefined): string[] {
	return accessToken && accessToken !== WEB_UI_COOKIE_SESSION_SENTINEL ? ["litellm_" + accessToken] : [];
}
