/**
 * SpendManagementEndpoint 共享常量与 helper
 *
 * 提取 `/spend/*` 端点共用的：
 * - 分页/聚合 limit 常量（消除 1/50/100/1000 散落）
 * - 排序方向白名单（asc / desc）
 * - 通用 try/catch 日志 helper：避免每个端点重复写 warn 包装
 *
 * 端点文件（`SpendManagementEndpoint.ts`）继续持有路由注册逻辑，仅消费本文件的常量与 helper。
 * 不修改路由签名、不修改 WebUI 消费契约，保留所有现有测试。
 */

/** 默认页码（无 page 参数时从 1 开始） */
export const DEFAULT_PAGE = 1;

/** 默认每页大小（WebUI Logs / 旧分页契约共用的默认 pageSize） */
export const DEFAULT_PAGE_SIZE = 50;

/** 单页最大行数上限（防御性白名单：避免 ?pageSize=999999 把 DB 抽干） */
export const MAX_PAGE_SIZE = 100;

/** /spend/keys、/spend/users、/spend/tags 等聚合端点默认 group 数 */
export const AGGREGATE_DEFAULT_LIMIT = 100;

/** /global/spend/keys、/global/spend/models 自定义 limit 上限 */
export const AGGREGATE_MAX_LIMIT = 1000;

/** /global/spend/teams daily_spend 矩阵条数上限（按 date x team 笛卡尔积） */
export const DAILY_SPEND_MATRIX_LIMIT = 1000;

/** /global/activity 默认返回近 30 天 */
export const GLOBAL_ACTIVITY_DAY_LIMIT = 30;

/**
 * 排序方向白名单 — 仅允许这两个值进入 ORDER BY 子句。
 * 任何其它用户输入一律按 DESC 处理，规避 ORDER BY 注入风险。
 * 对齐 WebUI Logs 页面 sort_order=asc/desc 协议。
 */
export enum SpendSortOrder {
	ASC = "asc",
	DESC = "desc",
}

/**
 * 把原始 sort_order 字符串白名单化为 `SpendSortOrder`。
 * 非法值回退为 DESC（与 WebUI 默认语义一致，且 SQL 安全）。
 * @param raw - 原始 query 字符串
 */
export function normalizeSortOrder(raw: unknown): SpendSortOrder {
	return raw === SpendSortOrder.ASC ? SpendSortOrder.ASC : SpendSortOrder.DESC;
}

/**
 * 解析 query 中的 page 参数，钳位到 [1, +∞)。
 * @param raw - req.query.page 原始值
 */
export function parsePageParam(raw: unknown): number {
	// 保持原有行为：仅接受字符串；数组/对象等其它类型视为非法（按 DEFAULT_PAGE 处理）
	const parsed = parseInt(typeof raw === "string" ? raw : "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PAGE;
}

/**
 * 解析 query 中的 pageSize 参数，钳位到 [1, MAX_PAGE_SIZE]。
 * 兼容 snake_case（`page_size`）和 camelCase（`pageSize`），优先 snake_case。
 * @param rawSnake - `page_size` 原始值
 * @param rawCamel - `pageSize` 原始值
 * @param fallback - 解析失败时使用的默认值
 */
export function parsePageSizeParam(rawSnake: unknown, rawCamel: unknown, fallback: number = DEFAULT_PAGE_SIZE): number {
	// 保持原有行为：pageSize 不取数组首元素，原始字符串解析
	const raw = rawSnake ?? rawCamel;
	const parsed = parseInt(typeof raw === "string" ? raw : "", 10);
	const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
	return Math.min(MAX_PAGE_SIZE, Math.max(1, safe));
}

/**
 * 解析 query 中的 limit 参数（聚合端点专用），钳位到 [1, AGGREGATE_MAX_LIMIT]。
 * @param raw - req.query.limit 原始值
 * @param fallback - 解析失败时使用的默认值（通常 AGGREGATE_DEFAULT_LIMIT）
 */
export function parseAggregateLimitParam(raw: unknown, fallback: number = AGGREGATE_DEFAULT_LIMIT): number {
	// 保持原有行为
	const parsed = parseInt(typeof raw === "string" ? raw : "", 10);
	const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
	return Math.min(AGGREGATE_MAX_LIMIT, Math.max(1, safe));
}

/**
 * 把多查询端点通用的 `try { ... } catch (err) { logger.warn(...); return <fallback> }`
 * 收敛为单个 helper，避免每个端点重复写 warn 包装。
 * @template T - 成功与失败时的返回值类型
 * @param logger - 端点级模块 logger（如 `createModuleLogger("SpendMgmt")`）
 * @param context - 端点路径/名称，写入 warn 日志前缀便于定位
 * @param fallback - 失败兜底返回值（端点空对象 / 空数组 / 空分页对象等）
 * @param action - 实际查询逻辑；其返回值即为 helper 的成功返回值
 */
export async function runWithFallback<T>(
	logger: { warn: (msg: string) => void },
	context: string,
	fallback: T,
	action: () => Promise<T>,
): Promise<T> {
	try {
		return await action();
	} catch (err) {
		logger.warn(`${context} query failed: ${(err as Error).message}`);
		return fallback;
	}
}
