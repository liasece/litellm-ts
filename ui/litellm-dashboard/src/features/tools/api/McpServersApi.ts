import { z } from "zod";
import {
	requestJson,
	dashboardFetch,
	getApiBaseUrl,
	deriveErrorMessage,
	WEB_UI_COOKIE_SESSION_SENTINEL,
} from "../../platform/api/HttpApiClient";
import type {
	MCPServer,
	DiscoverMCPServersResponse,
	OpenAPIEntry,
	McpToolsResponse,
	MCPContent,
	MCPSubmissionsSummary,
} from "../support/McpModels";
const record = z.record(z.string(), z.unknown()),
	server = z.object({ server_id: z.string() }).passthrough();
const base = "/v1/mcp";
function mutation(path: string, method: string, body?: Record<string, unknown>) {
	return requestJson(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }, (value) => record.parse(value));
}
export const mcpApi = {
	list: (signal?: AbortSignal) => requestJson(base + "/server", { signal }, (value) => z.array(server).parse(value) as MCPServer[]),
	health: (ids?: string[]) =>
		requestJson(
			base + "/server/health" + (ids?.length ? "?" + ids.map((id) => "server_ids=" + encodeURIComponent(id)).join("&") : ""),
			undefined,
			(value) => z.array(z.object({ server_id: z.string(), status: z.string() }).passthrough()).parse(value),
		),
	create: (body: Record<string, unknown>, admin = true) => mutation(base + (admin ? "/server" : "/server/register"), "POST", body),
	update: (body: Record<string, unknown>) => mutation(base + "/server", "PUT", body),
	delete: (id: string) => requestJson(base + "/server/" + encodeURIComponent(id), { method: "DELETE" }),
	discover: () =>
		requestJson(
			base + "/discover",
			undefined,
			(value) =>
				z
					.object({ servers: z.array(record).optional().default([]), categories: z.array(z.string()).optional().default([]) })
					.parse(value) as unknown as DiscoverMCPServersResponse,
		),
	openapi: () =>
		requestJson(
			base + "/openapi-registry",
			undefined,
			(value) => z.object({ apis: z.array(record).optional().default([]) }).parse(value).apis as unknown as OpenAPIEntry[],
		),
	submissions: () =>
		requestJson(
			base + "/server/submissions",
			undefined,
			(value) =>
				z
					.object({
						total: z.number(),
						pending_review: z.number(),
						active: z.number(),
						rejected: z.number(),
						items: z.array(server),
					})
					.parse(value) as MCPSubmissionsSummary,
		),
	approve: (id: string) => mutation(base + "/server/" + encodeURIComponent(id) + "/approve", "PUT"),
	reject: (id: string, notes?: string) =>
		mutation(base + "/server/" + encodeURIComponent(id) + "/reject", "PUT", { review_notes: notes ?? null }),
	saveUserCredential: (id: string, credential: string, save: boolean) =>
		mutation(base + "/server/" + encodeURIComponent(id) + "/user-credential", "POST", { credential, save }),
	clientIp: () =>
		requestJson(
			base + "/network/client-ip",
			undefined,
			(value) => z.object({ ip: z.string().nullish() }).parse(value).ip || null,
		).catch(() => null),
	testTools: async (config: Record<string, unknown>, token?: string | null): Promise<McpToolsResponse> => {
		const headers = new Headers({ "Content-Type": "application/json", "x-litellm-api-key": WEB_UI_COOKIE_SESSION_SENTINEL });
		if (token) headers.set("Authorization", "Bearer " + token);
		const response = await dashboardFetch(getApiBaseUrl() + "/mcp-rest/test/tools/list", {
			method: "POST",
			headers,
			body: JSON.stringify(config),
		});
		if (!response.headers.get("content-type")?.includes("application/json"))
			throw new Error(`Received non-JSON response (${response.status}: ${response.statusText}). Check network tab for details.`);
		const result = record.parse(await response.json());
		if (!response.ok && !result.error)
			return {
				tools: [],
				error: "request_failed",
				message:
					typeof result.message === "string"
						? result.message
						: `MCP tools list failed: ${response.status} ${response.statusText}`,
			};
		return parseTools(result);
	},
	tools: async (id: string, headers?: Record<string, string>): Promise<McpToolsResponse> => {
		try {
			return await requestJson("/mcp-rest/tools/list?server_id=" + encodeURIComponent(id), { headers }, parseTools);
		} catch (error) {
			return {
				tools: [],
				error: "network_error",
				message: error instanceof Error ? error.message : "Failed to fetch MCP tools",
				stack_trace: null,
			};
		}
	},
	callTool: (id: string, name: string, args: Record<string, unknown>, headers?: Record<string, string>) =>
		requestJson(
			"/mcp-rest/tools/call",
			{ method: "POST", headers, body: JSON.stringify({ server_id: id, name, arguments: args }) },
			(value) =>
				z
					.object({ content: z.array(record) })
					.passthrough()
					.parse(value).content as unknown as MCPContent[],
		),
};
function parseTools(value: unknown): McpToolsResponse {
	const parsed = z
		.object({
			tools: z
				.array(
					z
						.object({
							name: z.string(),
							description: z.string().optional(),
							inputSchema: z.unknown().optional(),
							mcp_info: record.optional(),
						})
						.passthrough(),
				)
				.optional()
				.default([]),
			error: z.unknown().optional(),
			message: z.string().optional(),
			stack_trace: z.string().nullable().optional(),
		})
		.passthrough()
		.parse(value);
	return parsed as unknown as McpToolsResponse;
}
export function parseOpenAPIEntries(value: unknown): OpenAPIEntry[] {
	return z.array(z.object({ name: z.string(), spec_url: z.string() }).passthrough()).parse(value) as OpenAPIEntry[];
}
export async function semanticTest(model: string, query: string) {
	const response = await dashboardFetch(getApiBaseUrl() + "/v1/responses", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model,
			input: [{ role: "user", content: query, type: "message" }],
			tools: [{ type: "mcp", server_url: "litellm_proxy", require_approval: "never" }],
			tool_choice: "required",
		}),
	});
	const body: unknown = await response.json();
	if (!response.ok) throw new Error(deriveErrorMessage(body));
	return { filter: response.headers.get("x-litellm-semantic-filter"), tools: response.headers.get("x-litellm-semantic-filter-tools") };
}
