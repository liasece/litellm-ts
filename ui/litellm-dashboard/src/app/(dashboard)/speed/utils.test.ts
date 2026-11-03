import { describe, expect, it } from "vitest";
import {
	buildSpeedChartRows,
	buildSpeedStrokeStops,
	filterSpeedModels,
	formatSpeedBucketLabel,
	formatTps,
	resolveSpeedAxisMax,
	resolveSpeedRange,
	SPEED_FULL_SATURATION_TPS,
	speedStrokeColor,
} from "./utils";
import type { SpeedModelSeries, SpeedPoint } from "./types";

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
	it("统一保留一位小数", () => {
		expect(formatTps(89.04)).toBe("89.0");
		expect(formatTps(100)).toBe("100.0");
	});

	it("非有限值与空值显示占位符而不是 NaN", () => {
		expect(formatTps(Number.NaN)).toBe("-");
		expect(formatTps(null)).toBe("-");
	});
});

describe("formatSpeedBucketLabel", () => {
	it("小时桶给出本地日期与时刻", () => {
		// 2026-11-02T16:00Z = 上海 11-03 00:00
		expect(formatSpeedBucketLabel(Date.parse("2026-11-02T16:00:00Z"), "hour", "Asia/Shanghai")).toBe(
			"11/03 00:00",
		);
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
		{ model: "MiniMax-M3", calls: 10, requests: 9, avg_tps: 90, p50_tps: 80, points: [] },
		{ model: "cliproxy/gpt-6-astra", calls: 5, requests: 5, avg_tps: 20, p50_tps: 18, points: [] },
	];

	it("空搜索词返回全部模型", () => {
		expect(filterSpeedModels(models, "  ")).toHaveLength(2);
	});

	it("大小写不敏感地匹配模型名", () => {
		expect(filterSpeedModels(models, "minimax").map((entry) => entry.model)).toEqual(["MiniMax-M3"]);
		expect(filterSpeedModels(models, "GPT-6").map((entry) => entry.model)).toEqual(["cliproxy/gpt-6-astra"]);
	});
});

/** 从 hsl(...) 文本里取出色相，便于比较「红不红」 */
const hueOf = (color: string): number => Number(color.slice(4, color.indexOf(",")));

describe("speedStrokeColor", () => {
	it("200 TPS 恰好是 100% 饱和的纯红", () => {
		expect(SPEED_FULL_SATURATION_TPS).toBe(200);
		expect(speedStrokeColor(200)).toBe("hsl(0.0, 100.0%, 45%)");
	});

	it("超过 200 不会更红，避免极端值抢走视觉重点", () => {
		expect(speedStrokeColor(500)).toBe(speedStrokeColor(200));
		expect(speedStrokeColor(1234.5)).toBe(speedStrokeColor(200));
	});

	it("速度越高色相越靠近红", () => {
		expect(hueOf(speedStrokeColor(0))).toBeGreaterThan(hueOf(speedStrokeColor(100)));
		expect(hueOf(speedStrokeColor(100))).toBeGreaterThan(hueOf(speedStrokeColor(200)));
	});

	it("负值与非有限值按 0 处理", () => {
		expect(speedStrokeColor(-10)).toBe(speedStrokeColor(0));
		expect(speedStrokeColor(Number.NaN)).toBe(speedStrokeColor(0));
		expect(speedStrokeColor(Number.POSITIVE_INFINITY)).toBe(speedStrokeColor(0));
	});
});


describe("buildSpeedStrokeStops", () => {
	it("从上到下按取值排序，两端分别对应本图最大/最小值", () => {
		const stops = buildSpeedStrokeStops(0, 100);

		expect(stops[0]!.offset).toBe(0);
		expect(stops[0]!.color).toBe(speedStrokeColor(100));
		expect(stops[stops.length - 1]!.offset).toBe(1);
		expect(stops[stops.length - 1]!.color).toBe(speedStrokeColor(0));
		for (let index = 1; index < stops.length; index += 1) {
			expect(stops[index]!.offset).toBeGreaterThan(stops[index - 1]!.offset);
		}
	});

	it("纵轴从 0 起不影响配色：颜色只由取值决定", () => {
		// 数据在 60~120 之间时，渐变覆盖的仍是 60~120，而不是被轴上的 0 拉伸
		const stops = buildSpeedStrokeStops(60, 120);

		expect(stops[0]!.color).toBe(speedStrokeColor(120));
		expect(stops[stops.length - 1]!.color).toBe(speedStrokeColor(60));
		expect(stops.map((stop) => stop.color)).not.toContain(speedStrokeColor(200));
	});

	it("跨过 200 后按纯红封顶：200 以上所有停靠点同色", () => {
		const stops = buildSpeedStrokeStops(0, 400);
		const boundary = stops.find((stop) => Math.abs(stop.offset - 0.5) < 1e-9);

		expect(boundary).toBeDefined();
		expect(boundary!.color).toBe(speedStrokeColor(200));
		expect(stops.filter((stop) => stop.offset <= 0.5).every((stop) => stop.color === speedStrokeColor(200))).toBe(
			true,
		);
		expect(hueOf(stops[stops.length - 1]!.color)).toBeGreaterThan(hueOf(speedStrokeColor(200)));
	});

	it("单点数据退化为同一颜色，不产生非法 offset", () => {
		const stops = buildSpeedStrokeStops(90, 90);

		expect(stops).toHaveLength(2);
		expect(stops.every((stop) => stop.color === speedStrokeColor(90))).toBe(true);
		expect(stops.every((stop) => stop.offset >= 0 && stop.offset <= 1)).toBe(true);
	});
});
