import { describe, expect, it } from "vitest";
import { usageLineGeometry } from "./UsageLineGeometryLogic";

const input = {
	width: 517,
	height: 320,
	yAxisWidth: 56,
	showXAxis: true,
	index: "date",
	categories: ["metrics.total_tokens"],
	format: (v: number) => v.toLocaleString("en-US"),
	measureText: () => 92,
	data: [
		{ date: "2026-11-05", metrics: { total_tokens: 3000 } },
		{ date: "2026-11-06", metrics: { total_tokens: 6000 } },
		{ date: "2026-11-07", metrics: { total_tokens: 9000 } },
	],
};

describe("usage area behaviour", () => {
	it("covers the samples with a five-tick value range", () => {
		const result = usageLineGeometry(input);

		expect(result.axes.scale.ticks).toHaveLength(5);
		expect(result.axes.scale.ticks.at(-1)).toBeGreaterThanOrEqual(9000);
	});

	it("keeps missing data as separate segments instead of joining a gap or fabricating zero", () => {
		const result = usageLineGeometry({ ...input, data: [input.data[0], { date: "2026-11-06", metrics: {} }, input.data[2]] });

		expect(result.series[0].linePaths).toHaveLength(2);
	});

	it("isolates a single sample instead of stretching it across the plot", () => {
		const result = usageLineGeometry({ ...input, categories: ["spend"], data: [{ date: "today", spend: 2 }] });

		expect(result.series[0].linePaths).toHaveLength(1);
		expect(result.series[0].linePaths[0]).not.toContain("L");
	});

	it("connects missing samples only when the chart asks for it", () => {
		const data = [input.data[0], { date: "2026-11-06", metrics: {} }, input.data[2]];

		expect(usageLineGeometry({ ...input, data, curve: "natural", connectNulls: true }).series[0].linePaths).toHaveLength(1);
		expect(usageLineGeometry({ ...input, data, curve: "natural" }).series[0].linePaths).toHaveLength(2);
	});
});

describe("secondary hit rate axis", () => {
	it("maps percentages onto the right axis and reserves a right gutter", () => {
		const data = [
			{ date: "2026-11-05", metrics: { total_tokens: 3000 }, hit_rate: 50 },
			{ date: "2026-11-06", metrics: { total_tokens: 6000 }, hit_rate: 100 },
		];
		const result = usageLineGeometry({ ...input, data, rightAxisWidth: 48, secondaryCategories: ["hit_rate"] });
		const primary = usageLineGeometry({ ...input, data });

		expect(result.axes.rightTicks.map((tick) => tick.text)).toEqual(["0%", "25%", "50%", "75%", "100%"]);
		expect(result.axes.rightTicks[0].x).toBe(result.axes.left + result.axes.plotWidth + 8);
		expect(result.axes.plotWidth).toBe(primary.axes.plotWidth - 48);
		expect(result.secondarySeries[0].points[0]!.y).toBeCloseTo(result.axes.top + result.axes.plotHeight / 2, 6);
		expect(result.secondarySeries[0].points[1]!.y).toBeCloseTo(result.axes.top, 6);
	});
});
