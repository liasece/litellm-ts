import { localDateForTimestamp, localDayRangeUtc, localDayStartUtc, parseDailyActivityTimezone } from "./DailyActivityTimezone";

describe("Usage 浏览器本地时区", () => {
	it("把上海本地零点映射到前一个 UTC 日 16:00", () => {
		expect(localDayStartUtc("2026-11-17", -480).toISOString()).toBe("2026-11-16T16:00:00.000Z");
		expect(localDayRangeUtc("2026-11-17", "2026-11-17", -480)).toEqual({
			start: new Date("2026-11-16T16:00:00.000Z"),
			endExclusive: new Date("2026-11-17T16:00:00.000Z"),
		});
	});
	it("能处理跨日期的本地范围", () => {
		expect(localDayRangeUtc("2026-11-16", "2026-11-17", -480)).toEqual({
			start: new Date("2026-11-15T16:00:00.000Z"),
			endExclusive: new Date("2026-11-17T16:00:00.000Z"),
		});
	});
	it("把原始日志时间转换为请求时区的本地日期", () => {
		const instant = new Date("2026-11-16T18:30:00.000Z");
		expect(localDateForTimestamp(instant, { name: "Asia/Shanghai", offsetMinutes: null })).toBe("2026-11-17");
		expect(localDateForTimestamp(instant, { name: null, offsetMinutes: -480 })).toBe("2026-11-17");
		expect(localDateForTimestamp(instant, { name: null, offsetMinutes: 0 })).toBe("2026-11-16");
	});
	it("优先使用 IANA 名称，并拒绝非法值", () => {
		expect(parseDailyActivityTimezone({ timezone: "-480" })).toEqual({ name: null, offsetMinutes: -480 });
		expect(parseDailyActivityTimezone({ timezone_name: "Asia/Shanghai", timezone: "-480" })).toEqual({
			name: "Asia/Shanghai",
			offsetMinutes: null,
		});
		expect(parseDailyActivityTimezone({ timezone_name: "UTC" })).toBeNull();
		expect(() => parseDailyActivityTimezone({ timezone_name: "Mars/Olympus" })).toThrow("timezone_name");
		expect(() => parseDailyActivityTimezone({ timezone: "-841" })).toThrow("timezone");
		expect(() => parseDailyActivityTimezone({ timezone: "abc" })).toThrow("timezone");
	});
});
