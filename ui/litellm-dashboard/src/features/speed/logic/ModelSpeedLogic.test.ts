import { describe, expect, it } from "vitest";
import {
	buildSpeedChartRows,
	filterSpeedModels,
	formatSpeedBucketLabel,
	formatTps,
	resolveSpeedAxisMax,
	resolveSpeedRange,
	speedModelKey,
} from "./ModelSpeedLogic";
import type { SpeedModelSeries, SpeedPoint } from "../support/SpeedModels";

const point = (bucket: string, avg = 90, p50 = 80, requests = 4): SpeedPoint => ({
	bucket,
	avg_tps: avg,
	p50_tps: p50,
	requests,
});

describe("resolveSpeedRange", () => {
	it("按浏览器时区推导「最近 N 天」，结束日是当地今天", () => {
		// UTC 2026-11-02T20:00 已经是上海 11-03
		const now = new Date("2026-11-02T20:00:00Z");
		expect(resolveSpeedRange(7, "Asia/Shanghai", now)).toEqual({
			startDate: "2026-10-28",
			endDate: "2026-11-03",
		});
		expect(resolveSpeedRange(1, "Asia/Shanghai", now)).toEqual({
			startDate: "2026-11-03",
			endDate: "2026-11-03",
		});
	});

	it("天数非法时至少取一天", () => {
		const now = new Date("2026-11-03T04:00:00Z");
		expect(resolveSpeedRange(0, "UTC", now)).toEqual({ startDate: "2026-11-03", endDate: "2026-11-03" });
	});
});

describe("formatTps", () => {
	it("非有限值与空值显示占位符而不是 NaN", () => {
		expect(formatTps(Number.NaN)).toBe("-");
		expect(formatTps(null)).toBe("-");
	});
});

describe("formatSpeedBucketLabel", () => {
	it("小时桶给出本地日期与时刻", () => {
		// 2026-11-02T16:00Z = 上海 11-03 00:00
		expect(formatSpeedBucketLabel(Date.parse("2026-11-02T16:00:00Z"), "hour", "Asia/Shanghai")).toBe("11/03 00:00");
	});

	it("按天桶只给日期", () => {
		expect(formatSpeedBucketLabel(Date.parse("2026-11-02T16:00:00Z"), "day", "Asia/Shanghai")).toBe("11/03");
	});
});

describe("buildSpeedChartRows", () => {
	const axis = ["2026-11-02T00:00:00Z", "2026-11-02T01:00:00Z", "2026-11-02T02:00:00Z"];

	it("铺满完整时间轴，没有样本的时段留 null 让曲线断开", () => {
		const rows = buildSpeedChartRows([point("2026-11-02T00:00:00Z", 80, 70, 5)], axis, "hour", "Asia/Shanghai");

		expect(rows.map((row) => row.tps)).toEqual([80, null, null]);
		expect(rows.map((row) => row.p50)).toEqual([70, null, null]);
		expect(rows.map((row) => row.requests)).toEqual([5, 0, 0]);
	});

	it("中间的缺口同样留空，不会被前后两点连起来", () => {
		const rows = buildSpeedChartRows(
			[point("2026-11-02T00:00:00Z", 80), point("2026-11-02T02:00:00Z", 95)],
			axis,
			"hour",
			"Asia/Shanghai",
		);

		expect(rows.map((row) => row.tps)).toEqual([80, null, 95]);
	});

	it("沿用后端时间轴的顺序与本地时间标签", () => {
		const rows = buildSpeedChartRows([point("2026-11-02T02:00:00Z", 95)], axis, "hour", "Asia/Shanghai");

		expect(rows.map((row) => row.timestamp)).toEqual([
			Date.parse("2026-11-02T00:00:00Z"),
			Date.parse("2026-11-02T01:00:00Z"),
			Date.parse("2026-11-02T02:00:00Z"),
		]);
		expect(rows[2]!.label).toBe("11/02 10:00");
	});

	it("轴上有无法解析的时间点就跳过，不产生 NaN 刻度", () => {
		const rows = buildSpeedChartRows([], ["not-a-time", "2026-11-02T01:00:00Z"], "hour", "UTC");
		expect(rows).toHaveLength(1);
		expect(rows[0]!.tps).toBeNull();
	});
});

describe("resolveSpeedAxisMax", () => {
	const series = (model: string, values: number[]): SpeedModelSeries => ({
		model,
		provider: "minimax",
		calls: values.length,
		requests: values.length,
		avg_tps: values.length > 0 ? values[0]! : 0,
		p50_tps: values.length > 0 ? values[0]! : 0,
		points: values.map((value, index) => ({
			bucket: new Date(Date.UTC(2026, 10, 1, index)).toISOString(),
			avg_tps: value,
			p50_tps: value,
			requests: 3,
		})),
	});

	it("取所有可见模型里最高的采样值，而不是第一张卡片的最大值", () => {
		expect(resolveSpeedAxisMax([series("a", [80, 88]), series("b", [132, 19])])).toBe(132);
	});

	it("只有一个模型时就是它自己的峰值", () => {
		expect(resolveSpeedAxisMax([series("a", [80, 95])])).toBe(95);
	});

	it("没有模型或没有数据点时返回 0，交给图表退化为最小刻度", () => {
		expect(resolveSpeedAxisMax([])).toBe(0);
		expect(resolveSpeedAxisMax([series("a", [])])).toBe(0);
	});

	it("忽略非有限数值，避免把轴拉到 NaN/Infinity", () => {
		expect(resolveSpeedAxisMax([series("a", [Number.NaN, 60, Number.POSITIVE_INFINITY])])).toBe(60);
	});
});

describe("filterSpeedModels", () => {
	const models: SpeedModelSeries[] = [
		{ model: "MiniMax-M3", provider: "minimax", calls: 10, requests: 9, avg_tps: 90, p50_tps: 80, points: [] },
		{ model: "claude-opus-4-5", provider: "opencode-go", calls: 5, requests: 5, avg_tps: 95, p50_tps: 90, points: [] },
		{ model: "claude-opus-4-5", provider: "claude-subscription", calls: 4, requests: 4, avg_tps: 40, p50_tps: 38, points: [] },
	];

	it("空搜索词返回全部模型", () => {
		expect(filterSpeedModels(models, "  ")).toHaveLength(3);
	});

	it("大小写不敏感地匹配模型名", () => {
		expect(filterSpeedModels(models, "minimax").map((entry) => entry.model)).toEqual(["MiniMax-M3"]);
		expect(filterSpeedModels(models, "CLAUDE-OPUS").map((entry) => entry.model)).toEqual(["claude-opus-4-5", "claude-opus-4-5"]);
	});

	it("也能按供应商筛选同名模型，找到具体是哪一条曲线", () => {
		expect(filterSpeedModels(models, "opencode").map(speedModelKey)).toEqual(["opencode-go\u0000claude-opus-4-5"]);
		expect(filterSpeedModels(models, "claude-subscription").map(speedModelKey)).toEqual(["claude-subscription\u0000claude-opus-4-5"]);
	});
});
