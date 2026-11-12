import type { SpendMetrics } from "../support/UsageModels";
import { cacheHitRate } from "./UsageChartLogic";

export type TokenMetricFields = Pick<
	SpendMetrics,
	"prompt_tokens" | "completion_tokens" | "total_tokens" | "cache_read_input_tokens" | "cache_creation_input_tokens"
>;

export interface UsageTokenBreakdown {
	/** Prompt tokens that were not served from cache (cache writes stay part of input). */
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
	/** Cache read divided by all prompt tokens, rounded to a whole percent. */
	hitRate: number;
	inputShare: number;
	outputShare: number;
	cacheReadShare: number;
}

function amount(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function share(value: number, total: number): number {
	return total > 0 ? (value / total) * 100 : 0;
}

/**
 * Splits the reported usage into the three parts shown across the Usage page:
 * uncached input, output and cache reads. The three parts add up to total tokens;
 * cache writes are reported separately because providers already count them in input.
 */
export function usageTokenBreakdown(metrics: TokenMetricFields): UsageTokenBreakdown {
	const prompt = amount(metrics.prompt_tokens);
	const cacheRead = Math.min(amount(metrics.cache_read_input_tokens), prompt);
	const input = Math.max(prompt - cacheRead, 0);
	const output = amount(metrics.completion_tokens);
	const total = amount(metrics.total_tokens) || prompt + output;
	return {
		input,
		output,
		cacheRead,
		cacheWrite: amount(metrics.cache_creation_input_tokens),
		total,
		hitRate: cacheHitRate(cacheRead, prompt),
		inputShare: share(input, total),
		outputShare: share(output, total),
		cacheReadShare: share(cacheRead, total),
	};
}

export function tokenChartFields(metrics: TokenMetricFields): {
	input: number;
	output: number;
	cache_read: number;
	hit_rate: number;
} {
	const tokens = usageTokenBreakdown(metrics);
	return { input: tokens.input, output: tokens.output, cache_read: tokens.cacheRead, hit_rate: tokens.hitRate };
}
