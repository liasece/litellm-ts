import { describe, expect, it } from "vitest";
import { usageAxisScale, preserveEndTicks } from "./UsageAxisScaleLogic";
import { usageBarGeometry } from "./UsageBarGeometryLogic";
const base = {
	index: "date",
	categories: ["spend"],
	width: 651,
	height: 288,
	yAxisWidth: 100,
	showXAxis: true,
	format: (value: number) => "$" + value,
	measureText: (text: string) => text.length * 7,
};
describe("usage chart behaviour", () => {
	it("keeps a rounded five-tick domain that still contains the data", () => {
		expect(usageAxisScale(0, 6).ticks).toHaveLength(5);
		expect(usageAxisScale(0, 6).ticks.at(-1)).toBeGreaterThanOrEqual(6);
		expect(usageAxisScale(0, 7.5).ticks.at(-1)).toBeGreaterThanOrEqual(7.5);
		expect(usageAxisScale(0, 0).ticks).toEqual([0, 1, 2, 3, 4]);
	});
	it("supports negative credits and small fractional costs", () => {
		expect(usageAxisScale(-6, 0).ticks).toEqual([-8, -6, -4, -2, 0]);
		expect(usageAxisScale(0, 0.0006).ticks).toEqual([0, 0.00015, 0.0003, 0.00045, 0.0006]);
	});
	it("labels only the ranking rows that have room for them", () => {
		const g = usageBarGeometry({
			...base,
			data: [
				{ date: "gpt-4.1", spend: 7.5 },
				{ date: "claude-sonnet-4", spend: 4.5 },
			],
			width: 453,
			height: 80,
			yAxisWidth: 160,
			horizontal: true,
			ranking: true,
		});
		expect(g.yTicks).toHaveLength(1);
	});
	it("keeps a wide value label inside the chart", () => {
		const g = usageBarGeometry({
			...base,
			data: [{ date: "Key 1", spend: 7.5 }],
			width: 453,
			height: 80,
			yAxisWidth: 160,
			horizontal: true,
			ranking: true,
			format: (value) => "$" + value.toFixed(3),
		});
		const last = g.xTicks.at(-1)!;
		expect(last.x).toBeLessThan(g.left + g.plotWidth);
		expect(last.x + base.measureText(last.text) / 2).toBeLessThanOrEqual(g.width);
	});
	it("stacks credits separately from positive spend", () => {
		const g = usageBarGeometry({ ...base, categories: ["a", "b", "c"], stack: true, data: [{ date: "Nov 5", a: 4, b: -2, c: 3 }] });
		const [a, b, c] = g.bars;
		expect(c.y + c.height).toBeCloseTo(a.y, 10);
		expect(b.y).toBeCloseTo(a.y + a.height, 10);
		expect(b.height).toBeGreaterThan(0);
		expect(g.scale.min).toBeLessThanOrEqual(-2);
		expect(g.scale.max).toBeGreaterThanOrEqual(7);
	});
	it("does not pass array indices as optional formatter precision", () => {
		const geometry = usageBarGeometry({
			...base,
			format: (value, places = 0) => value.toFixed(places),
			data: [{ date: "today", spend: 4 }],
		});
		expect(geometry.yTicks.map((tick) => tick.text)).toEqual(["0", "1", "2", "3", "4"]);
	});
	it("does not overlap close row labels", () => {
		expect(preserveEndTicks([14.5, 35.5], [24, 24], 80)).toEqual([{ index: 1, coordinate: 35.5 }]);
	});
});
