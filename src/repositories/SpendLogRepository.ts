/**
 * LiteLLM_SpendLogs 仓库 — 花费流水行的唯一写入点，以及按 `request_id` 的最小读取面。
 *
 * 流水表按请求增长（生产早已过百万行），整理表副本或按键缓存都没有意义：每次落账都是
 * 新行，读取也总是按 `request_id` 或分页窗口命中少量行。因此这里只提供 SQL，不维护
 * 任何进程内副本；结算提交后由调用方失效鉴权缓存（见 `AuthRepositoryCache`），
 * 预算读者不会读到上一次提交之前的 spend。
 *
 * 列表、会话时间线与 Lease 回收路径共用的投影列也放在这里：执行模型回退、耗时兜底、
 * metadata 过滤必须得到同一个值，这些列表达式属于「这张表怎么读」，不属于某个端点。
 * 投影函数只构造 SQL 表达式，不执行查询，因此可以由只读报表仓储自由复用。
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { BaseRepository } from "../core/db/BaseRepository";
import type { DrizzleDb } from "../core/db/Database";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { singletonFor } from "./internal/registry";

/** `LiteLLM_SpendLogs` 行。 */
export type SpendLogRow = typeof liteLLM_SpendLogs.$inferSelect;

/** 新建 SpendLog 行时可写入的列。 */
export type SpendLogInsertValues = typeof liteLLM_SpendLogs.$inferInsert;

/** 事务句柄；结算路径由调用方开启事务，本仓库只把 SQL 放进同一事务。 */
export type SpendLogTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

/** 回收行做内容寻址编码时只需要这两列。 */
export interface RecoveredSpendLogPayload {
	/** 被回收的请求 ID；与 ActiveRequests 行一一对应。 */
	readonly requestId: string;
	/** 回收时原样搬进 SpendLogs 的代理请求负载；可能仍是未编码的大 JSON。 */
	readonly proxyServerRequest: unknown;
}

/**
 * 取得与数据库连接绑定的花费流水仓库。
 * @param db - Drizzle 数据库实例
 */
export const spendLogRepositoryFor = singletonFor((db: DrizzleDb) => new SpendLogRepository(db));

/** `LiteLLM_SpendLogs` 的 SQL 访问点。 */
export class SpendLogRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例（BaseRepository 构造为 protected，显式公开子类构造）
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	/**
	 * 插入一条流水；`request_id` 已存在时不覆盖并返回 false。
	 *
	 * 幂等键是 `request_id`：同一请求的第二次落账（客户端重试、重复 finalize）必须放弃，
	 * 由调用方据此跳过主体累计与日汇总，避免把同一笔费用记两次。
	 * @param tx - 调用方事务句柄
	 * @param values - 完整流水行
	 * @returns 是否真的插入了新行
	 */
	async insertIgnore(tx: SpendLogTransaction, values: SpendLogInsertValues): Promise<boolean> {
		const inserted = await tx
			.insert(liteLLM_SpendLogs)
			.values(values)
			.onConflictDoNothing()
			.returning({ requestId: liteLLM_SpendLogs.request_id });
		return inserted.length > 0;
	}

	/**
	 * 改写流水行的代理请求负载（回收路径补做内容寻址编码时使用）。
	 *
	 * 回收 SQL 用 `INSERT ... SELECT` 把 ActiveRequests 的行原样搬进流水表，一次重启就能
	 * 留下完整的大请求体；这里按 `request_id` 把该列换成引用形态，保持与正常写路径一致。
	 * @param tx - 调用方事务句柄
	 * @param requestId - 被回收的请求 ID
	 * @param proxyServerRequest - 编码后的代理请求负载
	 */
	async updateProxyServerRequest(tx: SpendLogTransaction, requestId: string, proxyServerRequest: unknown): Promise<void> {
		await tx
			.update(liteLLM_SpendLogs)
			.set({ proxy_server_request: proxyServerRequest })
			.where(eq(liteLLM_SpendLogs.request_id, requestId));
	}

	/**
	 * 读取某次请求已落账的 spend；不存在时返回 null。
	 *
	 * 预算预留需要先确认这个 `request_id` 是否已经有一条历史流水：已落账的请求不能再开
	 * 一份新的预留，否则同一笔调用会在预留账本里出现两次。
	 * @param tx - 调用方事务句柄
	 * @param requestId - 请求 ID
	 * @returns 已落账 spend；没有历史行时为 null
	 */
	async findSpendByRequestId(tx: SpendLogTransaction, requestId: string): Promise<number | null> {
		// 保持原有的单条原始 SQL：预算预留只关心「这个 request_id 是否已落账」，
		// 走 execute 还能与同一事务里后续的 advisory lock / 余额查询复用同一条连接序列。
		const result = (await tx.execute(
			sql`SELECT spend FROM "LiteLLM_SpendLogs" WHERE request_id = ${requestId} LIMIT 1`,
		)) as unknown as { rows: Array<{ spend: number | null }> };
		const row = result.rows[0];
		return row === undefined ? null : (row.spend ?? 0);
	}

	/**
	 * 读取本次回收刚写入的流水行的代理请求负载。
	 *
	 * 用 `termination_reason` 精确定位本次事务写入的 aborted 行：同一批 request_id 可能
	 * 早就有历史流水，不能把别人的行重新编码一遍。
	 * @param tx - 调用方事务句柄
	 * @param requestIds - 本次回收的请求 ID
	 * @param terminationReason - 写入 metadata 的终止原因
	 * @returns 需要补做编码的行；没有匹配行时为空数组
	 */
	async findProxyPayloadsForRecovery(
		tx: SpendLogTransaction,
		requestIds: readonly string[],
		terminationReason: string,
	): Promise<RecoveredSpendLogPayload[]> {
		if (requestIds.length === 0) {
			return [];
		}
		const rows = await tx
			.select({ requestId: liteLLM_SpendLogs.request_id, proxyServerRequest: liteLLM_SpendLogs.proxy_server_request })
			.from(liteLLM_SpendLogs)
			.where(
				and(
					inArray(liteLLM_SpendLogs.request_id, [...requestIds]),
					sql`${liteLLM_SpendLogs.metadata}->>'termination_reason' = ${terminationReason}`,
				),
			);
		return rows.map((row) => ({ requestId: row.requestId, proxyServerRequest: row.proxyServerRequest }));
	}
}

/**
 * 失败调用且未记录 model_id 时，按上游请求里的真实模型归属（Python 兼容行为）。
 * @returns 执行模型列的 SQL 表达式
 */
export function spendLogExecutionModelProjection() {
	return sql<string>`CASE
		WHEN ${liteLLM_SpendLogs.status} = 'failure'
			AND COALESCE(${liteLLM_SpendLogs.model_id}, '') = ''
			AND ${liteLLM_SpendLogs.model} = ${liteLLM_SpendLogs.model_group}
			AND jsonb_typeof(${liteLLM_SpendLogs.proxy_server_request}#>'{upstream_request,body,model}') = 'string'
		THEN COALESCE(NULLIF(${liteLLM_SpendLogs.proxy_server_request}#>>'{upstream_request,body,model}', ''), ${liteLLM_SpendLogs.model})
		ELSE ${liteLLM_SpendLogs.model}
	END`;
}

/**
 * 列表耗时：DB NULL 时回退到 `endTime - startTime` 的毫秒数（对齐 Python UI logs）。
 * @returns 耗时列的 SQL 表达式
 */
export function spendLogDurationProjection() {
	return sql<number>`COALESCE(${liteLLM_SpendLogs.request_duration_ms}, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (${liteLLM_SpendLogs.endTime} - ${liteLLM_SpendLogs.startTime})) * 1000))::int)`;
}

/**
 * metadata 仅在原生 JSON object 时参与通用字段过滤；历史 string 不做不安全 cast。
 * @returns metadata jsonb 的 SQL 表达式
 */
export function spendLogMetadataJsonProjection() {
	return sql`CASE WHEN jsonb_typeof(${liteLLM_SpendLogs.metadata}) = 'object' THEN ${liteLLM_SpendLogs.metadata} ELSE '{}'::jsonb END`;
}

/**
 * 列表投影里的 metadata：剥掉流式 checkpoint 载荷与已投影的用量副本。
 *
 * 流式 checkpoint 会把累计正文搬进 metadata，单行可达数兆；列表读它只会放大每页响应，
 * 详情页正文来自 response 列与内容寻址块，不依赖这些内部键。
 * `additional_usage_values` / `usage_object` 已由 0019 投影到 cache token 列，列表读列即可。
 * @returns 精简 metadata 的 SQL 表达式
 */
export function spendLogListMetadataProjection() {
	return sql<
		unknown | null
	>`${liteLLM_SpendLogs.metadata} - 'streaming_execution' - 'responses_execution' - 'additional_usage_values' - 'usage_object'`;
}
