import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import type {
	GuardrailLogQuery,
	GuardrailsUsageOverview,
	GuardrailsUsageDetail,
	GuardrailsMonitorLog,
} from "../support/GuardrailsMonitorModels";
const optionalNumber = z.number().nullish(),
	row = z
		.object({
			id: z.string(),
			name: z.string(),
			type: z.string(),
			provider: z.string(),
			requestsEvaluated: z.number(),
			failRate: z.number(),
			avgScore: optionalNumber,
			avgLatency: optionalNumber,
			p95Latency: optionalNumber,
			falsePositiveRate: optionalNumber,
			falseNegativeRate: optionalNumber,
			status: z.string(),
			trend: z.string(),
		})
		.passthrough(),
	overview = z
		.object({
			rows: z.array(row).optional().default([]),
			totalRequests: z.number().optional(),
			totalBlocked: z.number().optional(),
			passRate: z.union([z.number(), z.string()]).optional(),
			chart: z.array(z.object({ date: z.string(), passed: z.number(), blocked: z.number() }).passthrough()).optional(),
		})
		.passthrough(),
	detail = z
		.object({
			guardrail_name: z.string(),
			description: z.string().nullish(),
			status: z.string(),
			provider: z.string(),
			type: z.string(),
			requestsEvaluated: z.number(),
			failRate: z.number(),
			avgScore: optionalNumber,
			avgLatency: optionalNumber,
		})
		.passthrough(),
	log = z
		.object({
			id: z.string(),
			timestamp: z.string(),
			action: z.enum(["blocked", "passed", "flagged"]),
			input: z.string().optional(),
			output: z.string().optional(),
			input_snippet: z.string().optional(),
			output_snippet: z.string().optional(),
			score: z.number().optional(),
			model: z.string().optional(),
			reason: z.string().optional(),
			latency_ms: z.number().optional(),
		})
		.passthrough();
function dates(startDate?: string, endDate?: string) {
	const params = new URLSearchParams();
	if (startDate) params.append("start_date", startDate);
	if (endDate) params.append("end_date", endDate);
	return params.size ? "?" + params : "";
}
export const guardrailsMonitorApi = {
	overview: (startDate?: string, endDate?: string, signal?: AbortSignal) =>
		requestJson(
			"/guardrails/usage/overview" + dates(startDate, endDate),
			{ signal },
			(value) => overview.parse(value) as GuardrailsUsageOverview,
		),
	detail: (id: string, startDate?: string, endDate?: string, signal?: AbortSignal) =>
		requestJson(
			"/guardrails/usage/detail/" + encodeURIComponent(id) + dates(startDate, endDate),
			{ signal },
			(value) => detail.parse(value) as GuardrailsUsageDetail,
		),
	logs: (options: GuardrailLogQuery, signal?: AbortSignal) => {
		const params = new URLSearchParams();
		if (options.guardrailId) params.append("guardrail_id", options.guardrailId);
		if (options.policyId) params.append("policy_id", options.policyId);
		if (options.page != null) params.append("page", String(options.page));
		if (options.pageSize != null) params.append("page_size", String(options.pageSize));
		if (options.action) params.append("action", options.action);
		if (options.startDate) params.append("start_date", options.startDate);
		if (options.endDate) params.append("end_date", options.endDate);
		return requestJson("/guardrails/usage/logs" + (params.size ? "?" + params : ""), { signal }, (value) => {
			const parsed = z
				.object({ logs: z.array(log), total: z.number().optional() })
				.passthrough()
				.parse(value);
			return { ...parsed, logs: parsed.logs as GuardrailsMonitorLog[] };
		});
	},
};
