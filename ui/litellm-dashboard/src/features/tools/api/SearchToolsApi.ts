import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import type { SearchTool, SearchConnectionResult, SearchResult } from "../support/SearchToolModels";
const tool = z
	.object({
		search_tool_id: z.string().optional(),
		search_tool_name: z.string(),
		litellm_params: z
			.object({
				search_provider: z.string(),
				api_key: z.string().optional(),
				api_base: z.string().optional(),
				timeout: z.number().optional(),
				max_retries: z.number().optional(),
			})
			.passthrough(),
		search_tool_info: z.object({ description: z.string().optional() }).passthrough().optional(),
		created_at: z.string().optional(),
		updated_at: z.string().optional(),
		is_from_config: z.boolean().optional(),
	})
	.passthrough();
const base = "/search_tools";
export const searchToolsApi = {
	list: (signal: AbortSignal) =>
		requestJson(
			base + "/list",
			{ signal },
			(value) => z.object({ search_tools: z.array(tool).optional().default([]) }).parse(value).search_tools as SearchTool[],
		),
	providers: () =>
		requestJson(
			base + "/ui/available_providers",
			undefined,
			(value) =>
				z
					.object({
						providers: z
							.array(z.object({ provider_name: z.string(), ui_friendly_name: z.string() }))
							.optional()
							.default([]),
					})
					.parse(value).providers,
		),
	create: (body: Record<string, unknown>) => requestJson(base, { method: "POST", body: JSON.stringify({ search_tool: body }) }),
	update: (id: string, body: Record<string, unknown>) =>
		requestJson(base + "/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify({ search_tool: body }) }),
	delete: (id: string) => requestJson(base + "/" + encodeURIComponent(id), { method: "DELETE" }),
	test: (params: Record<string, unknown>, signal?: AbortSignal) =>
		requestJson(
			base + "/test_connection",
			{ method: "POST", body: JSON.stringify({ litellm_params: params }), signal },
			(value) =>
				z
					.object({
						status: z.enum(["success", "error"]),
						message: z.string(),
						test_query: z.string().optional(),
						results_count: z.number().optional(),
						error_type: z.string().optional(),
					})
					.parse(value) as SearchConnectionResult,
		),
	query: (name: string, query: string) =>
		requestJson(
			"/v1/search/" + encodeURIComponent(name),
			{ method: "POST", body: JSON.stringify({ query, max_results: 5 }) },
			(value) =>
				z
					.object({
						results: z
							.array(z.object({ title: z.string(), url: z.string(), snippet: z.string() }))
							.optional()
							.default([]),
					})
					.parse(value).results as SearchResult[],
		),
};
