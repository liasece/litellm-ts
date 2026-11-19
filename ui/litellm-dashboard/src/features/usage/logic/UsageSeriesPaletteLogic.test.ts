import { describe, expect, it } from "vitest";
import { activitySeriesColors } from "./UsageSeriesPaletteLogic";
import { usageColors } from "./UsageChartLogic";

describe("activity series palette", () => {
	it("gives every series its own colour far beyond the hand-picked palette", () => {
		const colors = activitySeriesColors(40);
		expect(colors).toHaveLength(40);
		expect(new Set(colors).size).toBe(40);
		for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/);
	});

	it("keeps the existing palette for the first series and is stable across calls", () => {
		const colors = activitySeriesColors(20);
		// 前几个系列沿用原有语义色：已有页面的图例颜色不会因为这次扩展而改变。
		expect(colors[0]).toBe(usageColors.indigo);
		expect(colors[1]).toBe(usageColors.cyan);
		expect(colors[13]).toBe(usageColors.red);
		expect(activitySeriesColors(20)).toEqual(colors);
	});

	it("still never repeats a colour across a full detail page", () => {
		// detail 页大小是 100：同一张图最多 100 个实体，颜色空间必须撑得住不重复。
		const colors = activitySeriesColors(100);
		expect(new Set(colors).size).toBe(100);
	});

	it("returns no colour when there is nothing to draw", () => {
		expect(activitySeriesColors(0)).toEqual([]);
		expect(activitySeriesColors(-3)).toEqual([]);
	});
});
