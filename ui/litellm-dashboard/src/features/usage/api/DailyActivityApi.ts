import { z } from "zod";
import { requestJson, HttpApiError } from "../../platform/api/HttpApiClient";
import notifications from "../../notifications/logic/NotificationManager";
import type {
	DailyActivityResponse,
	UsageApi,
	UsageDetailResponse,
	UsageDetailView,
	UsageInsightsApi,
	UsageQuery,
	UsageSummaryResponse,
} from "../support/UsageModels";
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
const usageMetadata = z
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
	.passthrough();
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
		metadata: usageMetadata,
	})
	.passthrough();
const dayMetrics = z.object({ date: z.string(), metrics }).passthrough();
const dimensionItem = z.object({ key: z.string(), metrics, metadata: z.record(z.string(), z.unknown()).optional() }).passthrough();
const detailItem = dimensionItem
	.extend({
		daily: z.array(dayMetrics).default([]),
		top_api_keys: z.array(dimensionItem).optional(),
		top_models: z.array(dimensionItem).optional(),
	})
	.passthrough();
const summary = z
	.object({
		view: z.literal("summary"),
		results: z.array(dayMetrics),
		dimensions: z
			.object({
				models: z.array(dimensionItem).default([]),
				model_groups: z.array(dimensionItem).default([]),
				providers: z.array(dimensionItem).default([]),
				api_keys: z.array(dimensionItem).default([]),
				mcp_servers: z.array(dimensionItem).default([]),
				endpoints: z.array(dimensionItem).default([]),
				entities: z.array(dimensionItem).default([]),
			})
			.passthrough(),
		metadata: usageMetadata,
	})
	.passthrough();
const detailViews = [
	"models",
	"model_groups",
	"providers",
	"api_keys",
	"mcp_servers",
	"endpoints",
	"entities",
	"upstream_accounts",
] as const;
const detail = z
	.object({
		view: z.enum(detailViews),
		results: z.array(dayMetrics),
		items: z.array(detailItem),
		metadata: usageMetadata.extend({ total_count: z.number().int().nonnegative().default(0) }).passthrough(),
	})
	.passthrough();
export function parseDailyActivity(value: unknown): DailyActivityResponse {
	return report.parse(value);
}
export function parseDailyActivitySummary(value: unknown): UsageSummaryResponse {
	return summary.parse(value) as UsageSummaryResponse;
}
export function parseDailyActivityDetail(value: unknown): UsageDetailResponse {
	return detail.parse(value) as UsageDetailResponse;
}
export function localDate(date: Date): string {
	return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
export function dailyActivityPath(query: UsageQuery, page?: number, view?: UsageDetailView | "summary", pageSize = 1000): string {
	const endpoint = query.entity === "global" ? "user" : query.entity;
	const params = new URLSearchParams({ start_date: localDate(query.from), end_date: localDate(query.to) });
	if (page !== undefined) {
		params.set("page_size", String(pageSize));
		params.set("page", String(page));
	}
	if (view) params.set("view", view);
	params.set("timezone", String(new Date().getTimezoneOffset()));
	// 偏移量只能固定一个瞬间；历史日期跨夏令时切换时，IANA 名称才能按当地日历分桶。
	const timezoneName = Intl.DateTimeFormat().resolvedOptions().timeZone;
	if (timezoneName) params.set("timezone_name", timezoneName);
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
	const aggregated = page === undefined || view !== undefined;
	return "/" + endpoint + "/daily/activity" + (aggregated ? "/aggregated" : "") + "?" + params;
}
async function get<T>(path: string, signal: AbortSignal | undefined, parse: (value: unknown) => T): Promise<T> {
	try {
		return await requestJson(path, { signal, headers: { "Content-Type": "application/json" } }, parse);
	} catch (error: unknown) {
		if (!signal?.aborted && error instanceof HttpApiError) notifications.fromBackend(error.message);
		throw error;
	}
}
/**
 * detail 的页大小取后端上限（`buildDailyActivityDetail` 里 Math.min(100, …)）。
 *
 * 趋势图与折叠列表共用这份明细，且不再把余量并成 “Other”：实体按花费排序，免费却用量
 * 很大的模型会落在第一页之外，一次多取一些能少一轮补齐分页的请求。
 */
const DETAIL_PAGE_SIZE = 100;
export const dailyActivityApi: UsageApi & UsageInsightsApi = {
	page: (query, page, signal) => get(dailyActivityPath(query, page), signal, parseDailyActivity),
	aggregated: (query, signal) => get(dailyActivityPath(query), signal, parseDailyActivity),
	summary: (query, signal) => get(dailyActivityPath(query, undefined, "summary"), signal, parseDailyActivitySummary),
	detail: (query, view, page, signal) => get(dailyActivityPath(query, page, view, DETAIL_PAGE_SIZE), signal, parseDailyActivityDetail),
	full: (query, signal) => get(dailyActivityPath(query), signal, parseDailyActivity),
};
