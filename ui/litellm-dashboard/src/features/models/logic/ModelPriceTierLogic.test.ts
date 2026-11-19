/**
 * 模型峰谷定价解析：列表要按配置决定「一排还是两排」，非法配置不能显示成永远生效的峰时价。
 */
import { describe, expect, it } from "vitest";
import { modelCostTiers, parsePeakPricing, peakPricingSummary } from "./ModelPriceTierLogic";

const pricing = {
	windows: [
		{ days: [1, 2, 3, 4, 5], start: "09:00", end: "12:00" },
		{ days: [1, 2, 3, 4, 5], start: "14:00", end: "18:00" },
	],
	timezone: "Asia/Shanghai",
	multiplier: 2,
};

describe("parsePeakPricing", () => {
	it("keeps a usable config and defaults the timezone", () => {
		expect(parsePeakPricing(pricing)).toEqual(pricing);
		expect(parsePeakPricing({ ...pricing, timezone: undefined })?.timezone).toBe("Asia/Shanghai");
	});

	it("drops windows whose clock or weekday is malformed instead of guessing", () => {
		const parsed = parsePeakPricing({
			multiplier: 2,
			windows: [
				{ days: [1], start: "9:00", end: "12:00" },
				{ days: [0, 8], start: "09:00", end: "12:00" },
				{ days: [3], start: "09:00", end: "12:00" },
			],
		});
		expect(parsed?.windows).toEqual([{ days: [3], start: "09:00", end: "12:00" }]);
	});

	it("treats missing windows or a multiplier that never raises the price as no peak pricing", () => {
		expect(parsePeakPricing(undefined)).toBeUndefined();
		expect(parsePeakPricing({})).toBeUndefined();
		expect(parsePeakPricing({ windows: pricing.windows, multiplier: 1 })).toBeUndefined();
		expect(parsePeakPricing({ windows: [], multiplier: 2 })).toBeUndefined();
		expect(parsePeakPricing({ windows: [{ days: [], start: "09:00", end: "12:00" }], multiplier: 2 })).toBeUndefined();
	});

	it("sorts and de-duplicates weekdays so the summary reads in calendar order", () => {
		expect(
			parsePeakPricing({ windows: [{ days: [5, 1, 3, 1], start: "08:00", end: "09:00" }], multiplier: 1.5 })?.windows[0]?.days,
		).toEqual([1, 3, 5]);
	});
});

describe("modelCostTiers", () => {
	it("renders a single row without tier labels when the model has no peak pricing", () => {
		expect(modelCostTiers(undefined)).toEqual([{ key: "base", multiplier: 1 }]);
	});

	it("renders off-peak and peak rows with the configured multiplier", () => {
		expect(modelCostTiers(parsePeakPricing(pricing))).toEqual([
			{ key: "base", multiplier: 1, label: "Off-peak", icon: "Moon" },
			{ key: "peak", multiplier: 2, label: "Peak ×2", icon: "Sun" },
		]);
	});
});

describe("peakPricingSummary", () => {
	it("compresses consecutive weekdays and names the timezone", () => {
		expect(peakPricingSummary(parsePeakPricing(pricing)!)).toBe(
			"Peak ×2 during Mon–Fri 09:00–12:00, Mon–Fri 14:00–18:00 (Asia/Shanghai); other times use the off-peak price.",
		);
	});

	it("lists non-consecutive weekdays individually", () => {
		const summary = peakPricingSummary(
			parsePeakPricing({ windows: [{ days: [1, 3, 5], start: "09:00", end: "12:00" }], multiplier: 3 })!,
		);
		expect(summary).toContain("Mon, Wed, Fri 09:00–12:00");
	});
});
