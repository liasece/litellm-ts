import { z } from "zod";
import { usageRequestJson as requestJson } from "./UsageReadFeedback";
import { localDate } from "./DailyActivityApi";
const activity = z.object({
	tag: z.string(),
	active_users: z.number(),
	date: z.string(),
	period_start: z.string().optional(),
	period_end: z.string().optional(),
});
const summary = z.object({
	tag: z.string(),
	unique_users: z.number(),
	total_requests: z.number(),
	successful_requests: z.number(),
	failed_requests: z.number(),
	total_tokens: z.number(),
	total_spend: z.number(),
});
const user = z.object({
	user_id: z.string(),
	user_email: z.string().nullable(),
	user_agent: z.string().nullable(),
	successful_requests: z.number(),
	failed_requests: z.number(),
	total_requests: z.number(),
	total_tokens: z.number(),
	spend: z.number(),
});
export type ActiveUserPoint = z.infer<typeof activity>;
export type UserAgentSummary = z.infer<typeof summary>;
export type PerUserMetric = z.infer<typeof user>;
export interface PerUserReport {
	results: PerUserMetric[];
	total_count: number;
	page: number;
	page_size: number;
	total_pages: number;
}
function query(path: string, params: Record<string, string>, tags: string[]) {
	const search = new URLSearchParams(params);
	for (const tag of tags) search.append("tag_filters", tag);
	return path + "?" + search;
}
export const userAgentUsageApi = {
	tags: (signal?: AbortSignal) =>
		requestJson("/tag/distinct", { signal }, (v) =>
			z
				.object({ results: z.array(z.object({ tag: z.string() })) })
				.parse(v)
				.results.map((t) => t.tag),
		),
	activity: (period: "dau" | "wau" | "mau", end: Date, tags: string[], signal?: AbortSignal) =>
		requestJson(
			query("/tag/" + period, { end_date: localDate(end) }, tags),
			{ signal },
			(v) => z.object({ results: z.array(activity) }).parse(v).results,
		),
	summary: (from: Date, to: Date, tags: string[], signal?: AbortSignal) =>
		requestJson(
			query("/tag/summary", { start_date: localDate(from), end_date: localDate(to) }, tags),
			{ signal },
			(v) => z.object({ results: z.array(summary) }).parse(v).results,
		),
	users: (page: number, tags: string[], signal?: AbortSignal): Promise<PerUserReport> =>
		requestJson(query("/tag/user-agent/per-user-analytics", { page: String(page), page_size: "50" }, tags), { signal }, (v) =>
			z
				.object({
					results: z.array(user),
					total_count: z.number(),
					page: z.number(),
					page_size: z.number(),
					total_pages: z.number(),
				})
				.parse(v),
		),
};
