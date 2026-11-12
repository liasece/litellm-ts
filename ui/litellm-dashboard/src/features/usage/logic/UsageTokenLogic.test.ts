import { describe, expect, it } from "vitest";
import { tokenChartFields, usageTokenBreakdown } from "./UsageTokenLogic";

const usage = (overrides: Partial<Parameters<typeof usageTokenBreakdown>[0]> = {}) => ({
	prompt_tokens: 1_200,
	completion_tokens: 300,
	total_tokens: 1_500,
	cache_read_input_tokens: 700,
	cache_creation_input_tokens: 100,
	...overrides,
});

describe("usage token breakdown", () => {
	it("splits prompt tokens into uncached input and cache reads without double counting writes", () => {
		const tokens = usageTokenBreakdown(usage());
		expect(tokens).toMatchObject({ input: 500, output: 300, cacheRead: 700, cacheWrite: 100, total: 1_500, hitRate: 58 });
		expect(tokens.input + tokens.output + tokens.cacheRead).toBe(tokens.total);
		expect(tokens.inputShare + tokens.outputShare + tokens.cacheReadShare).toBeCloseTo(100, 6);
	});

	it("keeps the reported hit rate inside 0-100 when cache data is inconsistent", () => {
		expect(usageTokenBreakdown(usage({ cache_read_input_tokens: 3_000 }))).toMatchObject({ input: 0, hitRate: 100 });
		expect(usageTokenBreakdown(usage({ prompt_tokens: 0, cache_read_input_tokens: 0 })).hitRate).toBe(0);
	});

	it("falls back to prompt plus completion when the total is missing and charts the same split", () => {
		const tokens = usageTokenBreakdown(usage({ total_tokens: 0 }));
		expect(tokens.total).toBe(1_500);
		expect(tokenChartFields(usage())).toEqual({ input: 500, output: 300, cache_read: 700, hit_rate: 58 });
	});
});
