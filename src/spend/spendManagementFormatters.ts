/**
 * SpendManagementEndpoint 纯函数 formatter / 归一化 helper
 *
 * 把与数据库/路由无关的纯函数（数值安全、日期归一化、空对象形状、月度日期范围、合并占位等）
 * 集中到此文件，避免 `SpendManagementEndpoint.ts` 单文件超长。所有 helper 保持
 * 纯函数语义（无副作用），方便单元测试与跨端点复用。
 */

/**
 * 把任意输入转 finite number，NaN/Infinity 兜底为 fallback。
 * WebUI Tremor BarChart y=NaN 报错（`<rect> attribute y: Expected length, "NaN"`）的根因之一。
 * @param value
 * @param fallback
 */
export function toFiniteNumber(value: unknown, fallback = 0): number {
	const numericValue = Number(value);
	return Number.isFinite(numericValue) ? numericValue : fallback;
}

/**
 * 把任意输入归一为字符串：null/undefined 兜底为空字符串，非字符串经 String() 转换。
 * 用以消除多端点手写 `String(row.X ?? "")` 的重复。
 * @param value
 */
export function toSafeString(value: unknown): string {
	if (value === null || value === undefined) {
		return "";
	}
	return typeof value === "string" ? value : String(value);
}

/**
 * 把 Date / 字符串 / null 安全转 'YYYY-MM-DD' 字符串。
 * drizzle 的 timestamp 字段返回 Date 对象，而 WebUI `item.date` 期待字符串以判断 includes("-")。
 * @param value
 */
export function toDateString(value: unknown): string {
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) {
			return "";
		}
		return value.toISOString().slice(0, 10);
	}
	if (typeof value === "string") {
		if (value.length >= 10) {
			return value.slice(0, 10);
		}
		return value;
	}
	return "";
}

/**
 * 把单条 spend_logs 行归一化：
 * - date 字符串
 * - spend / total_tokens / prompt_tokens / completion_tokens 全为 finite number
 * - 保留原始字段（不丢失 request_id 等），仅覆盖 WebUI 关心字段
 * @param row
 */
export function normalizeSpendLogRow(row: Record<string, unknown>): Record<string, unknown> {
	return {
		...row,
		date: toDateString(row.startTime),
		spend: toFiniteNumber(row.spend),
		total_tokens: toFiniteNumber(row.total_tokens),
		prompt_tokens: toFiniteNumber(row.prompt_tokens),
		completion_tokens: toFiniteNumber(row.completion_tokens),
	};
}

/**
 * 构造一个空 spend row（spend=0、tokens=0），保留 date / startTime 字段，
 * 供补齐本月缺失日期使用。
 * @param dateStr - 'YYYY-MM-DD'
 */
export function makeEmptyDailySpendRow(dateStr: string): Record<string, unknown> {
	return {
		date: dateStr,
		spend: 0,
		total_tokens: 0,
		prompt_tokens: 0,
		completion_tokens: 0,
		startTime: new Date(`${dateStr}T00:00:00Z`),
	};
}

/**
 * /spend/logs 旧分页契约的空结果形状。
 * 当过滤结果为空或 DB 查询抛错时返回该对象，确保 WebUI 旧分页组件能正常显示
 * "无数据"而非触发 `.map` / `.toFixed` 崩溃。
 * @param page - 当前页码
 * @param pageSize - 每页大小
 */
export function makeEmptyLegacySpendLogsPage(
	page: number,
	pageSize: number,
): {
	data: Record<string, unknown>[];
	page: number;
	pageSize: number;
	total: number;
	hasMore: boolean;
} {
	return {
		data: [],
		page: page,
		pageSize: pageSize,
		total: 0,
		hasMore: false,
	};
}

/**
 * /spend/logs/ui 新分页契约的空结果形状。
 * @param page - 当前页码
 * @param pageSize - 每页大小
 */
export function makeEmptyUiSpendLogsPage(
	page: number,
	pageSize: number,
): {
	data: Record<string, unknown>[];
	total: number;
	page: number;
	page_size: number;
	total_pages: number;
} {
	return {
		data: [],
		total: 0,
		page: page,
		page_size: pageSize,
		total_pages: 0,
	};
}

/**
 * 生成本月从 1 号到今天（含）的所有 'YYYY-MM-DD' 字符串数组。
 * 本月第一天 00:00 UTC ~ 今天 23:59:59.999 UTC。
 * 用于 /global/spend/logs 兜底：即便 DB 查不到任何行或查询失败，
 * 也要返回本月每日 spend=0 的行，让 WebUI Monthly Spend BarChart
 * 的 Tremor rect y 不会变 NaN。
 * @param now - 当前时间（默认 new Date()，便于测试注入）
 */
export function getCurrentMonthDateRange(now: Date = new Date()): { firstDay: string; lastDay: string; dates: string[] } {
	const year = now.getUTCFullYear();
	const month = now.getUTCMonth();
	const today = now.getUTCDate();
	const monthPadded = String(month + 1).padStart(2, "0");
	const firstDay = `${year}-${monthPadded}-01`;
	const dates: string[] = [];
	for (let d = 1; d <= today; d++) {
		dates.push(`${year}-${monthPadded}-${String(d).padStart(2, "0")}`);
	}
	const lastDay = dates.at(-1) ?? firstDay;
	return { firstDay: firstDay, lastDay: lastDay, dates: dates };
}

/** /spend/tags 与 /global/spend/tags 行投影的目标形状 */
export interface TagSpendRow {
	/** tag 字符串（同时作为 BarChart index） */
	readonly name: string;
	/** 有限数字 spend（BarChart categories） */
	readonly spend: number;
	/** 原始 tag 字符串（与 name 保持一致） */
	readonly tag: string;
	/** 有限数字 total_spend（兼容 WebUI 旧字段） */
	readonly total_spend: number;
	/** 有限数字 total_tokens */
	readonly total_tokens: number;
	/** 索引签名：让 TagSpendRow 兼容 `Record<string, unknown>` 上下文（runWithFallback 通用 fallback） */
	readonly [key: string]: unknown;
}

/**
 * 把从 DB 聚合得到的 tag 维度行归一化为 WebUI TagBarChart 期望形状。
 * - tag → name / tag（字符串）
 * - total_spend → spend / total_spend（finite number）
 * - total_tokens → total_tokens（finite number）
 * @param row - DB 聚合行（tag/total_spend/total_tokens）
 */
export function normalizeTagSpendRow(row: { tag?: unknown; total_spend?: unknown; total_tokens?: unknown }): TagSpendRow {
	const tag = toSafeString(row.tag);
	const totalSpend = toFiniteNumber(row.total_spend);
	const totalTokens = toFiniteNumber(row.total_tokens);
	return {
		name: tag,
		spend: totalSpend,
		tag: tag,
		total_spend: totalSpend,
		total_tokens: totalTokens,
	};
}

/**
 * 把从 DB 聚合并 normalize 后的 spend rows 与本月每日空 rows 合并：
 * - 用 DB 行覆盖对应日期的 spend / total_tokens
 * - 缺失日期补 spend=0 的空行
 * - 返回按 date 升序的数组
 * @param dbRows - 已 normalize 过的 spend_logs 行（含 date 'YYYY-MM-DD'）
 * @param dates - 本月每日 'YYYY-MM-DD' 列表
 */
export function mergeWithCurrentMonthPlaceholder(dbRows: Record<string, unknown>[], dates: string[]): Record<string, unknown>[] {
	const merged = new Map<string, Record<string, unknown>>();
	for (const dateStr of dates) {
		merged.set(dateStr, makeEmptyDailySpendRow(dateStr));
	}
	for (const row of dbRows) {
		const dateStr = typeof row.date === "string" ? row.date : toDateString(row.startTime);
		if (!dateStr || !merged.has(dateStr)) {
			continue;
		}
		merged.set(dateStr, {
			...merged.get(dateStr),
			...row,
			date: dateStr,
			spend: toFiniteNumber(row.spend),
			total_tokens: toFiniteNumber(row.total_tokens),
			prompt_tokens: toFiniteNumber(row.prompt_tokens),
			completion_tokens: toFiniteNumber(row.completion_tokens),
			startTime: row.startTime instanceof Date ? row.startTime : new Date(`${dateStr}T00:00:00Z`),
		});
	}
	return Array.from(merged.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
