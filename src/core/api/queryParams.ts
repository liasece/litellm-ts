/**
 * 通用 query 参数解析 helper
 *
 * 集中以下最常用的解析原语，避免在多个端点（management/SpendManagement/ModelsPage…）
 * 里重复写相同的 firstQueryString/positive int 解析逻辑：
 * - firstQueryString：把 `unknown`（可能是数组、字符串、其它）安全归一为单字符串
 * - parsePositiveInt：在字符串上做 Number.parseInt + 范围钳位
 *
 * 域特定的 limit/pageSize（USER_LIST_PAGINATION、MAX_PAGE_SIZE 等）由各自端点
 * 文件持有，不进入本文件以避免过度抽象。
 */

/**
 * 从 query 原始值中取第一个字符串元素。
 * - undefined / null / 空字符串 / 非空对象 → null
 * - 数组 → 取首元素
 * - 其它值 → String() 后 trim
 * @param value - req.query.* 原始值
 */
export function firstQueryString(value: unknown): string | null {
	const raw = Array.isArray(value) ? value[0] : value;
	if (raw === undefined || raw === null) {
		return null;
	}
	const text = String(raw).trim();
	return text.length > 0 ? text : null;
}

/**
 * 把 query 字符串解析为正整数，非法值/非正数时回退到 fallback。
 * 不做上限钳位——上限由调用方决定（pageSize vs aggregate limit 语义不同）。
 * @param value - req.query.* 原始值
 * @param fallback - 解析失败或非正数时使用的值
 */
export function parsePositiveInt(value: unknown, fallback: number): number {
	const raw = firstQueryString(value);
	const parsed = Number.parseInt(raw ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
