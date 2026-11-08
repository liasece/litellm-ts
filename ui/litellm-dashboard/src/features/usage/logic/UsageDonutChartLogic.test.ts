import { describe, expect, it } from "vitest";
import { usageDonutGeometry, usageDonutTooltipPosition } from "./UsageDonutChartLogic";

const data = [
	{ provider: "openai", spend: 7.5 },
	{ provider: "anthropic", spend: 4.5 },
	{ provider: "unknown", spend: 0.03 },
];

const make = (width: number) =>
	usageDonutGeometry({ data, index: "provider", category: "spend", colors: ["cyan", "blue", "indigo"], width, height: 160 });

describe("Provider Usage donut", () => {
	it("shares the ring between providers in proportion and keeps the provider colors", () => {
		const result = make(566);

		expect(result.total).toBeCloseTo(12.03, 2);
		expect(result.sectors.map((sector) => sector.color)).toEqual(["#06b6d4", "#3b82f6", "#6366f1"]);
		expect(result.sectors).toHaveLength(3);
	});

	it("keeps the tooltip inside the chart", () => {
		const wide = make(566).sectors[0]!,
			narrow = make(167).sectors[0]!;

		const wideX = usageDonutTooltipPosition(wide.anchor.x, 163.453125, 566);

		expect(wideX).toBeGreaterThan(0);
		expect(usageDonutTooltipPosition(narrow.anchor.x, 163.453125, 167)).toBe(0);
	});

	it("does not invent slices for a zero total", () => {
		const result = usageDonutGeometry({
			data: [{ name: "empty", value: 0 }],
			index: "name",
			category: "value",
			colors: ["cyan"],
			width: 100,
			height: 160,
		});

		expect(result.total).toBe(0);
		expect(result.sectors[0]?.start).toBe(result.sectors[0]?.end);
	});
});
