import { describe, expect, it } from "vitest";
import { usageAxisScale } from "./UsageAxisScaleLogic";
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
	it("stacks credits separately from positive spend", () => {
		const g = usageBarGeometry({ ...base, categories: ["a", "b", "c"], stack: true, data: [{ date: "Nov 5", a: 4, b: -2, c: 3 }] });
		const [a, b, c] = g.bars;
		expect(c.y + c.height).toBeCloseTo(a.y, 10);
		expect(b.y).toBeCloseTo(a.y + a.height, 10);
		expect(b.height).toBeGreaterThan(0);
		expect(g.scale.min).toBeLessThanOrEqual(-2);
		expect(g.scale.max).toBeGreaterThanOrEqual(7);
	});
	it("rotates vertical category labels and reserves room below the plot", () => {
		const geometry = usageBarGeometry({
			...base,
			height: 280,
			yAxisWidth: 64,
			xAxisLabelAngle: 60,
			data: [
				{ date: "gpt-6-astra", spend: 4 },
				{ date: "/deepseek-v4.1-flash", spend: 3 },
				{ date: "MiniMax-M3.1-Flash", spend: 2 },
			],
		});
		const labels = geometry.xTicks.filter(
			(tick) => tick.text.startsWith("gpt") || tick.text.startsWith("/") || tick.text.startsWith("Mini"),
		);
		expect(geometry.bottom).toBeGreaterThan(30);
		expect(labels).toHaveLength(3);
		expect(labels.every((tick) => tick.transform?.startsWith("rotate(-60"))).toBe(true);
		expect(labels.every((tick) => tick.anchor === "end")).toBe(true);
		expect(geometry.plotHeight).toBeGreaterThan(0);
	});
	it("does not pass array indices as optional formatter precision", () => {
		const geometry = usageBarGeometry({
			...base,
			format: (value, places = 0) => value.toFixed(places),
			data: [{ date: "today", spend: 4 }],
		});
		expect(geometry.yTicks.map((tick) => tick.text)).toEqual(["0", "1", "2", "3", "4"]);
	});
});
