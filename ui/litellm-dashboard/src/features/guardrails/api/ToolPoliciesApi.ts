import { z } from "zod";
import { dashboardFetch, getApiBaseUrl, requestJson } from "../../platform/api/HttpApiClient";
import type {
	ToolPolicyRow,
	ToolPolicyDetail,
	ToolPolicyScope,
	ToolUsageLog,
	ToolKeyChoice,
	ToolPolicyChoice,
} from "../support/ToolPolicyModels";
const text = z.string().nullish(),
	tool = z
		.object({
			tool_id: z.string(),
			tool_name: z.string(),
			origin: text,
			input_policy: z.string(),
			output_policy: z.string(),
			call_count: z.number().nullish(),
			assignments: z.record(z.string(), z.unknown()).nullish(),
			key_hash: text,
			team_id: text,
			key_alias: text,
			created_at: z.string().optional(),
			updated_at: z.string().optional(),
			created_by: z.string().optional(),
			updated_by: z.string().optional(),
			user_agent: text,
			last_used_at: text,
		})
		.passthrough(),
	override = z
		.object({
			override_id: z.string(),
			tool_name: z.string(),
			team_id: text,
			key_hash: text,
			input_policy: z.string(),
			key_alias: text,
			created_at: z.string().optional(),
			updated_at: z.string().optional(),
		})
		.passthrough(),
	choice = z.object({ value: z.string(), label: z.string(), description: z.string() }).passthrough();
async function raw<T>(path: string, init: RequestInit = {}, parse: (value: unknown) => T) {
	const response = await dashboardFetch(getApiBaseUrl() + path, { headers: { "Content-Type": "application/json" }, ...init });
	if (!response.ok) throw new Error(await response.text());
	return parse(await response.json());
}
export const toolPoliciesApi = {
	list: (signal?: AbortSignal) =>
		raw(
			"/v1/tool/list",
			{ signal },
			(value) => z.object({ tools: z.array(tool).optional().default([]) }).parse(value).tools as ToolPolicyRow[],
		),
	detail: (name: string, signal?: AbortSignal) =>
		raw(
			"/v1/tool/" + encodeURIComponent(name) + "/detail",
			{ signal },
			(value) =>
				z
					.object({ tool, overrides: z.array(override) })
					.passthrough()
					.parse(value) as ToolPolicyDetail,
		),
	options: (signal?: AbortSignal) =>
		raw(
			"/v1/tool/policy/options",
			{ signal },
			(value) =>
				z
					.object({ input_policies: z.array(choice), output_policies: z.array(choice) })
					.passthrough()
					.parse(value) as { input_policies: ToolPolicyChoice[]; output_policies: ToolPolicyChoice[] },
		),
	update: (name: string, policies: { input_policy?: string; output_policy?: string }, scope?: ToolPolicyScope) => {
		const body: Record<string, string | undefined> = { tool_name: name };
		if (policies.input_policy != null) body.input_policy = policies.input_policy;
		if (policies.output_policy != null) body.output_policy = policies.output_policy;
		for (const field of ["team_id", "key_hash", "key_alias"] as const)
			if (scope?.[field] != null) body[field] = scope[field] || undefined;
		return raw("/v1/tool/policy", { method: "POST", body: JSON.stringify(body) }, (value) => tool.parse(value) as ToolPolicyRow);
	},
	deleteOverride: (name: string, scope: ToolPolicyScope) => {
		const params = new URLSearchParams();
		if (scope.team_id != null && scope.team_id !== "") params.set("team_id", scope.team_id);
		if (scope.key_hash != null && scope.key_hash !== "") params.set("key_hash", scope.key_hash);
		return raw(
			"/v1/tool/" + encodeURIComponent(name) + "/overrides" + (params.size ? "?" + params : ""),
			{ method: "DELETE", headers: {} },
			(value) => z.object({ deleted: z.boolean(), tool_name: z.string() }).parse(value),
		);
	},
	logs: (name: string, options: { page?: number; pageSize?: number; startDate?: string; endDate?: string }, signal?: AbortSignal) => {
		const params = new URLSearchParams();
		if (options.page != null) params.append("page", String(options.page));
		if (options.pageSize != null) params.append("page_size", String(options.pageSize));
		if (options.startDate) params.append("start_date", options.startDate);
		if (options.endDate) params.append("end_date", options.endDate);
		return requestJson(
			"/v1/tool/" + encodeURIComponent(name) + "/logs" + (params.size ? "?" + params : ""),
			{ signal },
			(value) =>
				z
					.object({
						logs: z.array(
							z
								.object({
									id: z.string(),
									timestamp: z.string(),
									model: text,
									spend: z.number().nullish(),
									total_tokens: z.number().nullish(),
									input_snippet: text,
								})
								.passthrough(),
						),
						total: z.number(),
						page: z.number(),
						page_size: z.number(),
					})
					.passthrough()
					.parse(value) as { logs: ToolUsageLog[]; total: number; page: number; page_size: number },
		);
	},
	keys: (signal?: AbortSignal) =>
		requestJson(
			"/key/list?page=1&size=100&return_full_object=true&include_team_keys=true&include_created_by_keys=true",
			{ signal },
			(value) => {
				const response = z.record(z.string(), z.unknown()).parse(value),
					rows = z
						.array(z.object({ token: text, api_key: text, key_hash: text, key_alias: text }).passthrough())
						.parse(response.keys ?? response.data ?? []);
				return rows.map((row) => {
					const token = row.token ?? row.api_key ?? row.key_hash ?? "";
					return { token, key_alias: row.key_alias ?? token.substring(0, 8) };
				}) as ToolKeyChoice[];
			},
		),
};
