import { describe, expect, it } from "vitest";
import { speedChartGeometry, speedTooltipPosition, speedValueTicks } from "./SpeedChartGeometryLogic";
import { speedTimeTicks } from "./SpeedTimeTickLogic";
import type { SpeedChartRow } from "./ModelSpeedLogic";

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const start = new Date(2026, 10, 1).getTime();
const rows = (values: (number | null)[]): SpeedChartRow[] =>
	values.map((tps, index) => ({
		timestamp: new Date(2026, 10, 1 + index).getTime(),
		label: "11/0" + (index + 1),
		tps,
		p50: tps === null ? null : tps - 5,
		requests: 20,
	}));

describe("Speed chart behaviour", () => {
	it("builds a value range that contains the maximum", () => {
		expect(speedValueTicks(132).at(-1)).toBe(132);
		expect(speedValueTicks(100).at(-1)).toBe(100);
		expect(speedValueTicks(0)).toEqual([0, 1]);
	});

	it("keeps missing samples as separate segments without inventing a value or a dot", () => {
		const geometry = speedChartGeometry({
			rows: rows([88, 92, null, 80, 100, null, 90]),
			width: 362,
			maximum: 132,
			bucket: "day",
			timezone,
			measureLabel: () => ({ width: 46.109375, height: 24 }),
		});

		expect(geometry.path.match(/M/g)).toHaveLength(3);
		expect(geometry.dots.map((dot) => dot.index)).toEqual([0, 1, 3, 4, 6]);
	});

	it("flips and bounds tooltips against the plot, without using the curve y value", () => {
		expect(speedTooltipPosition(87 + 2 / 3, 139.109375, 34, 356)).toBeCloseTo(97 + 2 / 3);
		expect(speedTooltipPosition(180, 139.109375, 34, 326)).toBe(34);
		expect(speedTooltipPosition(40, 58, 4, 70)).toBe(4);
	});

	it("generates local calendar day and hour ticks without adding endpoint samples", () => {
		expect(speedTimeTicks(start, new Date(2026, 10, 7).getTime())).toHaveLength(7);
		expect(speedTimeTicks(start, start + 6 * 3600_000)).toHaveLength(7);
		expect(speedTimeTicks(start, start)).toEqual([start]);
		expect(speedTimeTicks(start + 1, start)).toEqual([]);
		const month = speedTimeTicks(start, new Date(2026, 11, 1).getTime());
		expect(month.every((timestamp) => new Date(timestamp).getDay() === 0)).toBe(true);
	});
});
