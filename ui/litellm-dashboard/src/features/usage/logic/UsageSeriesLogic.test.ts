import { describe, expect, it } from "vitest";
import { activityBreakdownSeries, activitySeries, activityTooltipRows } from "./UsageSeriesLogic";
import type { BreakdownMetrics, DailyData, SpendMetrics, UsageDetailItem, UsageDetailResponse } from "../support/UsageModels";

function metrics(values: Partial<SpendMetrics> = {}): SpendMetrics {
	return {
		spend: 0,
		prompt_tokens: 0,
		completion_tokens: 0,
		total_tokens: 0,
		api_requests: 0,
		successful_requests: 0,
		failed_requests: 0,
		cache_read_input_tokens: 0,
		cache_creation_input_tokens: 0,
		...values,
	};
}

function item(key: string, daily: Array<[string, Partial<SpendMetrics>]>, metadata?: Record<string, unknown>): UsageDetailItem {
	return {
		key,
		metrics: metrics({
			spend: daily.reduce((sum, [, value]) => sum + (value.spend ?? 0), 0),
			total_tokens: daily.reduce((sum, [, value]) => sum + (value.total_tokens ?? 0), 0),
		}),
		daily: daily.map(([date, value]) => ({ date, metrics: metrics(value) })),
		metadata,
	};
}

function detail(items: UsageDetailItem[], days: Array<[string, Partial<SpendMetrics>]>): UsageDetailResponse {
	return {
		view: "models",
		results: days.map(([date, value]) => ({ date, metrics: metrics(value) })),
		items,
		metadata: {
			total_spend: 0,
			total_prompt_tokens: 0,
			total_completion_tokens: 0,
			total_tokens: 0,
			total_api_requests: 0,
			total_successful_requests: 0,
			total_failed_requests: 0,
			total_cache_read_input_tokens: 0,
			total_cache_creation_input_tokens: 0,
			total_pages: 1,
			has_more: false,
			page: 1,
			total_count: items.length,
		},
	};
}

describe("activity series charts", () => {
	it("splits each day into one bar segment per entity and keeps the daily total in Other", () => {
		const response = detail(
			[
				item("model-a", [
					["2026-11-16", { total_tokens: 100, spend: 1 }],
					["2026-11-17", { total_tokens: 50, spend: 0.5 }],
				]),
				item("model-b", [["2026-11-17", { total_tokens: 30, spend: 0.25 }]]),
				// 未出现在 items 里的用量由当天总量减去已选实体得到，保证柱子总和等于真实总量。
			],
			[
				["2026-11-16", { total_tokens: 100, spend: 1 }],
				["2026-11-17", { total_tokens: 90, spend: 1 }],
			],
		);
		const series = activitySeries(response, [], false);
		expect(series.slices.map((slice) => slice.label)).toEqual(["model-a", "model-b", "Other"]);
		expect(series.slices.at(-1)).toMatchObject({ other: true, tokens: 10, spend: 0.25 });
		expect(series.tokens.rows).toEqual([
			{ date: "2026-11-16", "model-a": 100, "model-b": 0, Other: 0 },
			{ date: "2026-11-17", "model-a": 50, "model-b": 30, Other: 10 },
		]);
		expect(series.spend.rows[1]!["Other"]).toBeCloseTo(0.25);
	});

	it("colors the same entity identically in both charts and never repeats a legend entry", () => {
		const response = detail(
			[item("a", [["2026-11-17", { total_tokens: 10, spend: 3 }]]), item("b", [["2026-11-17", { total_tokens: 20, spend: 2 }]])],
			[["2026-11-17", { total_tokens: 30, spend: 5 }]],
		);
		const series = activitySeries(response, [], false);
		expect(series.tokens.categories).toEqual(["a", "b"]);
		expect(series.spend.categories).toEqual(["a", "b"]);
		expect(series.tokens.colors).toEqual(series.spend.colors);
		expect(new Set(series.tokens.colors).size).toBe(2);
		// 当天全部用量都能对上已选实体时不再生成空的 Other 段。
		expect(series.slices.some((slice) => slice.other)).toBe(false);
	});

	it("labels api keys with their alias and keeps same-named keys apart", () => {
		const response = detail(
			[
				item("sk-1", [["2026-11-17", { total_tokens: 10, spend: 1 }]], { key_alias: "shared", team_id: null }),
				item("sk-2", [["2026-11-17", { total_tokens: 8, spend: 0.5 }]], { key_alias: "shared", team_id: null }),
				item("sk-3", [["2026-11-17", { total_tokens: 4, spend: 0.2 }]], { key_alias: "team-key", team_id: "team-1" }),
			],
			[["2026-11-17", { total_tokens: 22, spend: 1.7 }]],
		);
		const series = activitySeries(response, [{ team_id: "team-1", team_alias: "Alpha" }], true);
		expect(series.slices.map((slice) => slice.label)).toEqual(["shared", "shared (2)", "team-key (team: Alpha)"]);
	});

	it("keeps the best entities from both the spend and token rankings", () => {
		const response = detail(
			[
				item("cheap-but-huge", [["2026-11-17", { total_tokens: 1000, spend: 0.01 }]]),
				item("expensive", [["2026-11-17", { total_tokens: 10, spend: 100 }]]),
				item("middle", [["2026-11-17", { total_tokens: 500, spend: 1 }]]),
			],
			[["2026-11-17", { total_tokens: 1510, spend: 101.01 }]],
		);
		const series = activitySeries(response, [], false, 2);
		// 花费榜第一与 Token 榜第一都保留，`middle` 两个榜都不靠前，并入 Other。
		expect(series.slices.map((slice) => slice.label)).toEqual(["expensive", "cheap-but-huge", "Other"]);
	});

	it("ignores float noise instead of growing an Other legend entry", () => {
		const response = detail(
			[item("only", [["2026-11-17", { total_tokens: 10, spend: 1 }]])],
			[["2026-11-17", { total_tokens: 10.0000000001, spend: 1.0000000000000002 }]],
		);
		const series = activitySeries(response, [], false);
		expect(series.slices.map((slice) => slice.label)).toEqual(["only"]);
		expect(series.spend.rows[0]!["Other"]).toBe(0);
	});

	it("returns empty charts when the response has no usable items", () => {
		expect(activitySeries(null, [], false)).toEqual({
			slices: [],
			tokens: { rows: [], categories: [], colors: [] },
			spend: { rows: [], categories: [], colors: [] },
		});
		expect(activitySeries(detail([item("idle", [["2026-11-17", {}]])], [["2026-11-17", {}]]), [], false).slices).toEqual([]);
	});

	it("lists only the non-zero slices of the hovered day, largest first", () => {
		const response = detail(
			[item("a", [["2026-11-17", { total_tokens: 10, spend: 1 }]]), item("b", [["2026-11-17", { total_tokens: 40, spend: 2 }]])],
			[["2026-11-17", { total_tokens: 50, spend: 3 }]],
		);
		const series = activitySeries(response, [], false);
		expect(activityTooltipRows(series.spend, series.spend.rows[0]!)).toEqual([
			{ label: "b", color: series.spend.colors[0], value: 2 },
			{ label: "a", color: series.spend.colors[1], value: 1 },
		]);
	});
});

function day(date: string, metrics_value: Partial<SpendMetrics>, breakdown: Partial<BreakdownMetrics> = {}): DailyData {
	return {
		date,
		metrics: metrics(metrics_value),
		breakdown: {
			models: {},
			model_groups: {},
			mcp_servers: {},
			providers: {},
			api_keys: {},
			entities: {},
			endpoints: {},
			...breakdown,
		},
	};
}

function modelEntry(value: Partial<SpendMetrics>) {
	return { metrics: metrics(value), metadata: {}, api_key_breakdown: {} };
}

describe("activity breakdown series", () => {
	it("pivots the daily breakdown into one bar segment per model", () => {
		const days = [
			day(
				"2026-11-17",
				{ total_tokens: 90, spend: 1 },
				{
					models: {
						"model-a": modelEntry({ total_tokens: 40, spend: 0.5 }),
						"model-b": modelEntry({ total_tokens: 50, spend: 0.5 }),
					},
				},
			),
			day("2026-11-16", { total_tokens: 10, spend: 0.2 }, { models: { "model-a": modelEntry({ total_tokens: 10, spend: 0.2 }) } }),
		];
		const series = activityBreakdownSeries(days, "models", [], false);
		expect(series.slices.map((slice) => slice.label)).toEqual(["model-a", "model-b"]);
		expect(series.tokens.rows).toEqual([
			{ date: "2026-11-16", "model-a": 10, "model-b": 0, Other: 0 },
			{ date: "2026-11-17", "model-a": 40, "model-b": 50, Other: 0 },
		]);
	});

	it("labels keys through the alias and keeps same-named keys apart", () => {
		const entry = (tokens: number) => ({
			metrics: metrics({ total_tokens: tokens, spend: 1 }),
			metadata: { key_alias: "shared", team_id: null },
		});
		const days = [day("2026-11-17", { total_tokens: 30, spend: 2 }, { api_keys: { "sk-1": entry(20), "sk-2": entry(10) } })];
		const series = activityBreakdownSeries(days, "api_keys", [], true);
		expect(series.slices.map((slice) => slice.label)).toEqual(["shared", "shared (2)"]);
	});

	it("groups endpoints beyond the limit into Other", () => {
		const endpoints = Object.fromEntries(
			Array.from({ length: 9 }, (_, index) => ["/v1/e" + index, modelEntry({ total_tokens: 100 - index * 10, spend: 1 })]),
		);
		const days = [day("2026-11-17", { total_tokens: 540, spend: 9 }, { endpoints })];
		const series = activityBreakdownSeries(days, "endpoints", [], false, 3);
		expect(series.slices).toHaveLength(4);
		expect(series.slices.at(-1)).toMatchObject({ label: "Other", other: true });
		expect(series.slices.at(-1)!.tokens).toBeGreaterThan(0);
	});

	it("keeps agent names as labels for the entities dimension", () => {
		const days = [
			day("2026-11-17", { total_tokens: 30, spend: 2 }, { entities: { "agent-a": modelEntry({ total_tokens: 30, spend: 2 }) } }),
		];
		const series = activityBreakdownSeries(days, "entities", [], false);
		expect(series.slices.map((slice) => slice.label)).toEqual(["agent-a"]);
	});

	it("returns empty charts when the response has no breakdown", () => {
		expect(activityBreakdownSeries([], "models", [], false).slices).toEqual([]);
		expect(activityBreakdownSeries([day("2026-11-17", { total_tokens: 5, spend: 1 })], "models", [], false).slices).toEqual([]);
	});
});
