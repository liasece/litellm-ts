import { ApiError } from "../core/api/ApiError";

/**
 * Usage 日期过滤的请求时区。
 *
 * 优先使用 IANA 名称，才能让历史日期跨夏令时切换时仍按当地日历分桶；
 * `timezone` 是旧版 Dashboard 发送的 `Date.getTimezoneOffset()` 分钟数，
 * 保留它兼容未升级的调用方。
 */
export interface DailyActivityTimezone {
	/** IANA 时区名称；未提供时回落为固定偏移。 */
	readonly name: string | null;
	/** JavaScript getTimezoneOffset 语义的分钟数；使用 IANA 名称时为 null。 */
	readonly offsetMinutes: number | null;
}

/** JavaScript getTimezoneOffset 的理论范围是 UTC-14 到 UTC+12；留出整数分钟余量。 */
const MAX_TIMEZONE_OFFSET_MINUTES = 14 * 60;

/**
 * 解析请求中的时区。没有时区等于按 UTC 日桶查询，保留原有日汇总表路径。
 * @param query - HTTP query
 * @throws {ApiError} timezone_name 或 timezone 非法时拒绝请求
 */
export function parseDailyActivityTimezone(query: Record<string, unknown>): DailyActivityTimezone | null {
	const rawName = typeof query["timezone_name"] === "string" ? query["timezone_name"].trim() : "";
	if (rawName) {
		try {
			new Intl.DateTimeFormat("en-US", { timeZone: rawName }).format(0);
		} catch {
			throw ApiError.badRequest("timezone_name must be a valid IANA time zone name");
		}
		return rawName === "UTC" || rawName === "Etc/UTC" ? null : { name: rawName, offsetMinutes: null };
	}
	const rawOffset = query["timezone"];
	if (typeof rawOffset !== "string" || rawOffset.trim() === "") {
		return null;
	}
	const offset = Number(rawOffset);
	if (!Number.isInteger(offset) || Math.abs(offset) > MAX_TIMEZONE_OFFSET_MINUTES) {
		throw ApiError.badRequest("timezone must be an integer offset in minutes");
	}
	return offset === 0 ? null : { name: null, offsetMinutes: offset };
}

/**
 * 把任意 UTC 瞬时转换到请求时区的本地日历日。
 * @param date - UTC 瞬时
 * @param timezone - 已解析的请求时区
 */
export function localDateForTimestamp(date: Date, timezone: DailyActivityTimezone): string {
	if (timezone.name) {
		return new Intl.DateTimeFormat("en-CA", {
			timeZone: timezone.name,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).format(date);
	}
	return new Date(date.getTime() - (timezone.offsetMinutes ?? 0) * 60_000).toISOString().slice(0, 10);
}

/**
 * 返回 YYYY-MM-DD 的下一个日历日，供结束日开区间使用。
 * @param day - YYYY-MM-DD
 */
export function nextCalendarDay(day: string): string {
	const [year, month, date] = day.split("-").map(Number);
	return new Date(Date.UTC(year!, month! - 1, date! + 1)).toISOString().slice(0, 10);
}

/**
 * 把本地日历日转换成 UTC 瞬时；本地零点 = UTC 零点 + getTimezoneOffset()。
 * @param day - YYYY-MM-DD
 * @param timezoneOffsetMinutes - JavaScript getTimezoneOffset 语义的分钟数
 */
export function localDayStartUtc(day: string, timezoneOffsetMinutes: number): Date {
	const [year, month, date] = day.split("-").map(Number);
	return new Date(Date.UTC(year!, month! - 1, date!) + timezoneOffsetMinutes * 60_000);
}

/**
 * 校验并返回本地日期区间的 UTC 边界；结束日按“次日零点”作为开区间。
 * @param startDay - YYYY-MM-DD
 * @param endDay - YYYY-MM-DD
 * @param timezoneOffsetMinutes - JavaScript getTimezoneOffset 语义的分钟数
 */
export function localDayRangeUtc(
	startDay: string,
	endDay: string,
	timezoneOffsetMinutes: number,
): { readonly start: Date; readonly endExclusive: Date } {
	const endExclusiveDay = nextCalendarDay(endDay);
	return {
		start: localDayStartUtc(startDay, timezoneOffsetMinutes),
		endExclusive: localDayStartUtc(endExclusiveDay, timezoneOffsetMinutes),
	};
}
