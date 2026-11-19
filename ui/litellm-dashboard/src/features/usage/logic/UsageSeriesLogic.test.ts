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
	it("draws every entity instead of folding the tail into one bucket", () => {
		const response = detail(
			[
				item("model-a", [
					["2026-11-16", { total_tokens: 100, spend: 1 }],
					["2026-11-17", { total_tokens: 50, spend: 0.5 }],
				]),
				item("model-b", [["2026-11-17", { total_tokens: 30, spend: 0.25 }]]),
				item("model-c", [["2026-11-17", { total_tokens: 5, spend: 0.05 }]]),
			],
			[
				["2026-11-16", { total_tokens: 100, spend: 1 }],
				["2026-11-17", { total_tokens: 85, spend: 0.8 }],
			],
		);
		const series = activitySeries(response, [], false);
		expect(series.spend.slices.map((slice) => slice.label)).toEqual(["model-a", "model-b", "model-c"]);
		expect(series.tokens.rows).toEqual([
			{ date: "2026-11-16", "model-a": 100, "model-b": 0, "model-c": 0 },
			{ date: "2026-11-17", "model-a": 50, "model-b": 30, "model-c": 5 },
		]);
		// 每个实体都有独立颜色，柱段、图例与 tooltip 能一一对应。
		expect(new Set(series.tokens.colors).size).toBe(3);
		expect(series.tokens.categories).not.toContain("Other");
	});

	it("keeps a free model that tops the token ranking out of the spend chart", () => {
		// 生产回归：hy4-flash-free 花费为 0，按花费排序时排在 detail 末尾；前 7 名 + Other 的
		// 画法会把 409M token 并进 Other，图上再也看不出是谁在用量。
		const paid = Array.from({ length: 8 }, (_, index) =>
			item("paid-" + index, [["2026-11-19", { total_tokens: 100_000_000 - index * 1_000_000, spend: 10 - index }]]),
		);
		const response = detail(
			[...paid, item("hy4-flash-free", [["2026-11-19", { total_tokens: 409_216_161, spend: 0 }]])],
			[["2026-11-19", { total_tokens: 1_100_000_000, spend: 44 }]],
		);
		const series = activitySeries(response, [], false);
		expect(series.tokens.categories[0]).toBe("hy4-flash-free");
		expect(series.tokens.slices[0]).toMatchObject({ label: "hy4-flash-free", tokens: 409_216_161, spend: 0 });
		expect(new Set(series.tokens.colors).size).toBe(series.tokens.categories.length);
		// 这张图只看花费，免费模型没有花费可画，图例里不该出现一个恒为 0 的名字。
		expect(series.spend.categories).not.toContain("hy4-flash-free");
	});

	it("colors the same entity identically in both charts and never repeats a legend entry", () => {
		const response = detail(
			[item("a", [["2026-11-17", { total_tokens: 10, spend: 3 }]]), item("b", [["2026-11-17", { total_tokens: 20, spend: 2 }]])],
			[["2026-11-17", { total_tokens: 30, spend: 5 }]],
		);
		const series = activitySeries(response, [], false);
		// 图例顺序各按本榜排列，但同一实体在两张图里必须同色。
		expect(series.tokens.categories).toEqual(["b", "a"]);
		expect(series.spend.categories).toEqual(["a", "b"]);
		const colors = (chart: { categories: string[]; colors: string[] }) =>
			Object.fromEntries(chart.categories.map((label, index) => [label, chart.colors[index]]));
		expect(colors(series.tokens)).toEqual(colors(series.spend));
		expect(new Set(series.tokens.colors).size).toBe(2);
		expect(new Set(series.spend.colors).size).toBe(2);
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
		expect(series.tokens.slices.map((slice) => slice.label)).toEqual(["shared", "shared (2)", "team-key (team: Alpha)"]);
		// 两张图的图例文案保持一致：同名 key 的序号只按并集算一次。
		expect(series.spend.slices.map((slice) => slice.label)).toEqual(["shared", "shared (2)", "team-key (team: Alpha)"]);
	});

	it("ranks each chart by its own metric", () => {
		const response = detail(
			[
				item("cheap-but-huge", [["2026-11-17", { total_tokens: 1000, spend: 0.01 }]]),
				item("expensive", [["2026-11-17", { total_tokens: 10, spend: 100 }]]),
				item("middle", [["2026-11-17", { total_tokens: 500, spend: 1 }]]),
			],
			[["2026-11-17", { total_tokens: 1510, spend: 101.01 }]],
		);
		const series = activitySeries(response, [], false);
		expect(series.spend.categories).toEqual(["expensive", "middle", "cheap-but-huge"]);
		expect(series.tokens.categories).toEqual(["cheap-but-huge", "middle", "expensive"]);
	});

	it("omits entities that have no value for the chart's metric", () => {
		const response = detail(
			[item("only", [["2026-11-17", { total_tokens: 10, spend: 1 }]]), item("idle", [["2026-11-17", {}]])],
			[["2026-11-17", { total_tokens: 10, spend: 1 }]],
		);
		const series = activitySeries(response, [], false);
		expect(series.tokens.slices.map((slice) => slice.label)).toEqual(["only"]);
		expect(series.spend.slices.map((slice) => slice.label)).toEqual(["only"]);
	});

	it("returns empty charts when the response has no usable items", () => {
		const empty = { rows: [], categories: [], colors: [], slices: [] };
		expect(activitySeries(null, [], false)).toEqual({ tokens: empty, spend: empty });
		expect(activitySeries(detail([item("idle", [["2026-11-17", {}]])], [["2026-11-17", {}]]), [], false).spend.slices).toEqual([]);
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
		expect(series.spend.slices.map((slice) => slice.label)).toEqual(["model-a", "model-b"]);
		expect(series.tokens.rows).toEqual([
			{ date: "2026-11-16", "model-a": 10, "model-b": 0 },
			{ date: "2026-11-17", "model-a": 40, "model-b": 50 },
		]);
	});

	it("labels keys through the alias and keeps same-named keys apart", () => {
		const entry = (tokens: number) => ({
			metrics: metrics({ total_tokens: tokens, spend: 1 }),
			metadata: { key_alias: "shared", team_id: null },
		});
		const days = [day("2026-11-17", { total_tokens: 30, spend: 2 }, { api_keys: { "sk-1": entry(20), "sk-2": entry(10) } })];
		const series = activityBreakdownSeries(days, "api_keys", [], true);
		expect(series.spend.slices.map((slice) => slice.label)).toEqual(["shared", "shared (2)"]);
	});

	it("lists every endpoint instead of grouping the tail", () => {
		const endpoints = Object.fromEntries(
			Array.from({ length: 9 }, (_, index) => ["/v1/e" + index, modelEntry({ total_tokens: 100 - index * 10, spend: 1 })]),
		);
		const days = [day("2026-11-17", { total_tokens: 540, spend: 9 }, { endpoints })];
		const series = activityBreakdownSeries(days, "endpoints", [], false);
		expect(series.tokens.slices).toHaveLength(9);
		expect(series.tokens.categories).toEqual(Array.from({ length: 9 }, (_, index) => "/v1/e" + index));
		expect(new Set(series.tokens.colors).size).toBe(9);
	});

	it("keeps agent names as labels for the entities dimension", () => {
		const days = [
			day("2026-11-17", { total_tokens: 30, spend: 2 }, { entities: { "agent-a": modelEntry({ total_tokens: 30, spend: 2 }) } }),
		];
		const series = activityBreakdownSeries(days, "entities", [], false);
		expect(series.spend.slices.map((slice) => slice.label)).toEqual(["agent-a"]);
	});

	it("returns empty charts when the response has no breakdown", () => {
		expect(activityBreakdownSeries([], "models", [], false).spend.slices).toEqual([]);
		expect(activityBreakdownSeries([day("2026-11-17", { total_tokens: 5, spend: 1 })], "models", [], false).spend.slices).toEqual([]);
	});
});
