import { describe, expect, it } from "vitest";
import { usageDonutGeometry } from "./UsageDonutChartLogic";

const data = [
	{ provider: "openai", spend: 7.5 },
	{ provider: "anthropic", spend: 4.5 },
	{ provider: "unknown", spend: 0.03 },
];

const make = (width: number) =>
	usageDonutGeometry({ data, index: "provider", category: "spend", colors: ["cyan", "blue", "indigo"], width, height: 160 });

describe("Provider Usage donut", () => {
	it("shares the ring between providers in proportion", () => {
		const result = make(566);

		expect(result.total).toBeCloseTo(12.03, 2);
		expect(result.sectors).toHaveLength(3);
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
