import { describe, expect, it } from "vitest";
import { isNoDataRow, NO_DATA_KEY, padUsageRows, usageDayRange } from "./UsageEmptyDaysLogic";
describe("usageDayRange", () => {
	it("列出范围内每一天，含首尾", () => {
		expect(usageDayRange(new Date(2026, 10, 13, 23, 30), new Date(2026, 10, 16, 0, 30))).toEqual([
			"2026-11-13",
			"2026-11-14",
			"2026-11-15",
			"2026-11-16",
		]);
	});
	it("跨月跨年连续，不跳日也不重复", () => {
		expect(usageDayRange(new Date(2025, 11, 30), new Date(2026, 0, 2))).toEqual([
			"2025-12-30",
			"2025-12-31",
			"2026-01-01",
			"2026-01-02",
		]);
	});
	it("同一天只有一个日期", () => {
		expect(usageDayRange(new Date(2026, 2, 1, 8), new Date(2026, 2, 1, 20))).toEqual(["2026-03-01"]);
	});
	it("终点早于起点时为空，不反向补日期", () => {
		expect(usageDayRange(new Date(2026, 10, 16), new Date(2026, 10, 13))).toEqual([]);
	});
});
describe("padUsageRows", () => {
	const rows = [
		{ date: "2026-11-14", tokens: 5 },
		{ date: "2026-11-15", tokens: 0 },
	];
	it("把缺失的日期补成带哨兵的空行并保持升序", () => {
		const padded = padUsageRows(rows, ["2026-11-13", "2026-11-14", "2026-11-15"]);
		expect(padded.map((row) => row.date)).toEqual(["2026-11-13", "2026-11-14", "2026-11-15"]);
		expect(isNoDataRow(padded[0])).toBe(true);
		expect(padded[1]).toBe(rows[0]);
		// 当天有数据但数值为 0 是真实结果，不能被当成缺数据。
		expect(isNoDataRow(padded[2])).toBe(false);
		expect(padded[2]).toBe(rows[1]);
	});
	it("已有行的内容原样保留，不被空行覆盖", () => {
		const padded = padUsageRows(rows, ["2026-11-13", "2026-11-14", "2026-11-15"]);
		expect(padded[1]).toEqual({ date: "2026-11-14", tokens: 5 });
		expect(padded[0]).toEqual({ date: "2026-11-13", [NO_DATA_KEY]: true });
	});
	it("范围外多出来的日期照样保留，不丢后端返回的数据", () => {
		const padded = padUsageRows([...rows, { date: "2026-11-20", tokens: 9 }], ["2026-11-14", "2026-11-15"]);
		expect(padded.map((row) => row.date)).toEqual(["2026-11-14", "2026-11-15", "2026-11-20"]);
	});
	it("没有范围时只排序，不凭空造行", () => {
		expect(padUsageRows([{ date: "2026-11-15" }, { date: "2026-11-13" }], []).map((row) => row.date)).toEqual([
			"2026-11-13",
			"2026-11-15",
		]);
	});
	it("空数据加范围时整段都是空行", () => {
		const padded = padUsageRows([], ["2026-11-13", "2026-11-14"]);
		expect(padded).toHaveLength(2);
		expect(padded.every((row) => isNoDataRow(row))).toBe(true);
	});
});
