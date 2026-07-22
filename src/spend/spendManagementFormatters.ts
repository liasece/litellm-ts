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
		request_duration_ms: toFiniteNumber(row.request_duration_ms),
		metadata: parseJsonLikeValue(row.metadata),
		request_tags: parseJsonLikeValue(row.request_tags),
	};
}

/**
 * 兼容历史 JSON string 与新 JSON object/array。
 * @param value - 可能为 JSON 字符串或已解析对象的列值
 */
function parseJsonLikeValue(value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return value;
	}
}

/**
 * UI 路径 `/spend/logs/ui` 行归一化。
 *
 * 行为对齐 Python `ui_view_spend_logs` 返回结构：
 * - 复用 `normalizeSpendLogRow()` 的数值/日期规范化。
 * - 保留 snake_case 字段名（WebUI Logs 表格依赖 `request_id` / `user` / `team_id` 等原始命名）。
 * - 不引入重列 / 详情列。
 * - 不在行内注入 `session_total_count`；该字段由 `handleUiSpendLogs()` 在
 *   `enrichSessionCounts` 阶段聚合注入到每条 row。
 * @param row
 */
export function normalizeUiSpendLogRow(row: Record<string, unknown>): Record<string, unknown> {
	return normalizeSpendLogRow(row);
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * Format dates like Python `datetime.strftime("%b %d")` used by /global/activity endpoints.
 * @param value - DB date value from date_trunc or DATE() projection
 */
export function toPythonMonthDayString(value: unknown): string {
	const dateValue = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
	if (dateValue === null || Number.isNaN(dateValue.getTime())) {
		return toDateString(value);
	}
	return `${MONTH_LABELS[dateValue.getUTCMonth()]} ${String(dateValue.getUTCDate()).padStart(2, "0")}`;
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
