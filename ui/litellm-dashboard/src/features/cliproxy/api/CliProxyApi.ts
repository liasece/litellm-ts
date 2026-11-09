import { dashboardFetch } from "../../platform/api/HttpApiClient";
import { parseCliProxyResponse } from "./CliProxyResponseSchemas";

export async function cliProxyApi<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await dashboardFetch(path, {
		...init,
		headers: { "Content-Type": "application/json", ...init?.headers },
	});
	const body: unknown = await response.json().catch(() => ({}));
	if (!response.ok) {
		const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
		const nested = typeof record.error === "object" && record.error !== null ? (record.error as Record<string, unknown>) : {};
		throw new Error(String(nested.message ?? record.message ?? "HTTP " + response.status));
	}
	return parseCliProxyResponse(path, (init?.method ?? "GET").toUpperCase(), body) as T;
}

export async function advancedManagementApi(resource: string, method: string, requestBody: string): Promise<unknown> {
	const normalized = resource.startsWith("/") ? resource : "/" + resource;
	let body: string | undefined;
	if (["POST", "PUT", "PATCH"].includes(method) && requestBody.trim()) {
		body = JSON.stringify(JSON.parse(requestBody) as unknown);
	}
	const response = await dashboardFetch("/subscriptions/management" + normalized, {
		method,
		headers: body === undefined ? undefined : { "Content-Type": "application/json" },
		body,
	});
	const text = await response.text();
	let value: unknown = text;
	try {
		value = text.length > 0 ? (JSON.parse(text) as unknown) : null;
	} catch {
		/* Text downloads remain readable. */
	}
	if (!response.ok) {
		const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
		const nested = typeof record.error === "object" && record.error !== null ? (record.error as Record<string, unknown>) : {};
		throw new Error(String(nested.message ?? record.message ?? text ?? "HTTP " + response.status));
	}
	return value;
}
