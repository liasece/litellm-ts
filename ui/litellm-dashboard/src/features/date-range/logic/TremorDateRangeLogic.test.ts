import { describe, it, expect } from "vitest";
import { defaultTremorRanges, nextRange, dateKey } from "./TremorDateRangeLogic";
describe("original Tremor date selection", () => {
	const day = (value: number) => new Date(2026, 10, value);
	it("uses the actual seven-day subtraction rather than the advanced picker six-day window", () => {
		const option = defaultTremorRanges(day(7)).find((option) => option.value === "w")!;
		expect(dateKey(option.from)).toBe("2026-10-31");
		expect(dateKey(option.to)).toBe("2026-11-07");
	});
	it("extends existing ranges and preserves same-day clear behavior from the original calendar", () => {
		expect(nextRange({ from: day(2), to: day(5) }, day(1))).toEqual({ from: day(1), to: day(5) });
		expect(nextRange({ from: day(2), to: day(5) }, day(4))).toEqual({ from: day(2), to: day(4) });
		expect(nextRange({ from: day(2), to: day(5) }, day(5))).toEqual({ from: day(5), to: undefined });
		expect(nextRange({ from: day(2), to: day(2) }, day(2))).toEqual({});
	});
});
