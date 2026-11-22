import type { ChartRow } from "./UsageChartLogic";
import { localDate } from "../api/DailyActivityApi";

/** 图表行上的哨兵字段：这一天在所选范围里，但没有任何数据。 */
export const NO_DATA_KEY = "__noData";

/** 一个请求最多能跨多少天；只用于防止异常范围把循环拖死，不参与业务判断。 */
const MAX_RANGE_DAYS = 3700;

/**
 * 所选范围内每一天的本地日期（含首尾）。
 *
 * 用量接口按浏览器本地日历分桶（请求带 `start_date`/`end_date` 与时区），所以这里也用
 * `localDate` 生成同样的日期字串。用中午 12 点推进而不是加 24 小时，跨夏令时的日子仍是
 * 同一个日历日；直接加 86400000 会在 23 小时的那天跳过一天。
 * @param from - 范围起点
 * @param to - 范围终点
 */
export function usageDayRange(from: Date, to: Date): string[] {
	const start = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12),
		end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 12),
		days: string[] = [];
	for (let guard = 0; start <= end && guard < MAX_RANGE_DAYS; guard++) {
		days.push(localDate(start));
		start.setDate(start.getDate() + 1);
	}
	return days;
}

export function isNoDataRow(row: ChartRow): boolean {
	return row[NO_DATA_KEY] === true;
}

/**
 * 把图表行补齐到范围内每一天，缺失的日期插一行 `__noData`。
 *
 * 补 0 会把「当天没有请求」画成「用量为 0」的柱子和塌到底的折线；没有数据的日子应当占位
 * 并在图上标出来，所以插入的是带哨兵的空行，由图表渲染成灰带并在提示里写 No data。
 * 数据里有、范围里却没有的日期（后端返回了范围外的行）照样保留，不丢数据。
 * @param rows - 已有的图表行，按日期升序或乱序都可以
 * @param dates - 范围内每一天的日期
 */
export function padUsageRows(rows: readonly ChartRow[], dates: readonly string[]): ChartRow[] {
	if (!dates.length) return [...rows].sort(byDate);
	const present = new Map(rows.map((row) => [String(row.date ?? ""), row])),
		padded: ChartRow[] = [],
		known = new Set<string>();
	for (const date of dates) {
		known.add(date);
		padded.push(present.get(date) ?? { date: date, [NO_DATA_KEY]: true });
	}
	for (const row of rows) {
		const date = String(row.date ?? "");
		if (!known.has(date)) padded.push(row);
	}
	return padded.sort(byDate);
}

function byDate(left: ChartRow, right: ChartRow): number {
	return String(left.date ?? "").localeCompare(String(right.date ?? ""));
}
