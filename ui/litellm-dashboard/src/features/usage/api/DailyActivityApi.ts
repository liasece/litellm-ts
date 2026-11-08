import { z } from "zod";
import { requestJson, HttpApiError } from "../../platform/api/HttpApiClient";
import notifications from "../../notifications/logic/NotificationManager";
import type { DailyActivityResponse, UsageApi, UsageQuery } from "../support/UsageModels";
const number = z.number().finite().default(0);
const metrics = z
	.object({
		spend: number,
		prompt_tokens: number,
		completion_tokens: number,
		total_tokens: number,
		api_requests: number,
		successful_requests: number,
		failed_requests: number,
		cache_read_input_tokens: number,
		cache_creation_input_tokens: number,
	})
	.passthrough();
const keyMetadata = z
	.object({
		key_alias: z.string().nullable().default(null),
		key_name: z.string().nullable().optional(),
		team_id: z.string().nullable().default(null),
		tags: z.array(z.object({ tag: z.string(), usage: z.number() })).optional(),
	})
	.passthrough();
const keyMetric = z.object({ metrics, metadata: keyMetadata.default({ key_alias: null, team_id: null }) }).passthrough();
const item = z
	.object({
		metrics,
		metadata: z.record(z.string(), z.unknown()).default({}),
		api_key_breakdown: z.record(z.string(), keyMetric).default({}),
	})
	.passthrough();
const dictionary = z.record(z.string(), item).default({});
const report = z
	.object({
		results: z.array(
			z.object({
				date: z.string(),
				metrics,
				breakdown: z
					.object({
						models: dictionary,
						model_groups: dictionary,
						mcp_servers: dictionary,
						providers: dictionary,
						api_keys: z.record(z.string(), keyMetric).default({}),
						entities: dictionary,
						endpoints: dictionary,
					})
					.passthrough(),
			}),
		),
		metadata: z
			.object({
				total_spend: number,
				total_prompt_tokens: number,
				total_completion_tokens: number,
				total_tokens: number,
				total_api_requests: number,
				total_successful_requests: number,
				total_failed_requests: number,
				total_cache_read_input_tokens: number,
				total_cache_creation_input_tokens: number,
				total_pages: z.number().int().min(1).default(1),
				has_more: z.boolean().default(false),
				page: z.number().default(1),
			})
			.passthrough(),
	})
	.passthrough();
export function parseDailyActivity(value: unknown): DailyActivityResponse {
	return report.parse(value);
}
export function localDate(date: Date): string {
	return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
export function dailyActivityPath(query: UsageQuery, page?: number): string {
	const endpoint = query.entity === "global" ? "user" : query.entity;
	const params = new URLSearchParams({ start_date: localDate(query.from), end_date: localDate(query.to) });
	if (page !== undefined) {
		params.set("page_size", "1000");
		params.set("page", String(page));
	}
	params.set("timezone", String(new Date().getTimezoneOffset()));
	const keys = {
		global: "user_id",
		user: "user_id",
		team: "team_ids",
		organization: "organization_ids",
		customer: "end_user_ids",
		tag: "tags",
		agent: "agent_ids",
	};
	if (query.selected.length)
		params.set(keys[query.entity], query.entity === "global" || query.entity === "user" ? query.selected[0] : query.selected.join(","));
	if (query.entity === "team") params.set("exclude_team_ids", "litellm-dashboard-react-reference");
	return "/" + endpoint + "/daily/activity" + (page === undefined ? "/aggregated" : "") + "?" + params;
}
async function get(path: string, signal?: AbortSignal) {
	try {
		return await requestJson(path, { signal, headers: { "Content-Type": "application/json" } }, parseDailyActivity);
	} catch (error: unknown) {
		if (!signal?.aborted && error instanceof HttpApiError) notifications.fromBackend(error.message);
		throw error;
	}
}
export const dailyActivityApi: UsageApi = {
	page: (query, page, signal) => get(dailyActivityPath(query, page), signal),
	aggregated: (query, signal) => get(dailyActivityPath(query), signal),
};
