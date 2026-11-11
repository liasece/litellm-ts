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
