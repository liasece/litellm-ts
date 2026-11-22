/**
 * Spend 聚合与看板只读查询 — `LiteLLM_SpendLogs` / `LiteLLM_ActiveRequests` 的读端收口点。
 *
 * 这里的每个方法原本散落在 `/global/spend*`、`/spend/cost*`、`/spend/report`、
 * `/global/model_speed`、日志可见性与 Session 游标等端点里，是「按请求/行增长」的流水表
 * 聚合查询：数据随请求实时变化，整表或按键缓存都没有意义（缓存会把一次聚合结果固化到
 * 下一次请求），因此本仓储**只提供方法、不做任何缓存**。
 *
 * 迁移只搬 SQL 位置，不改语义：时间窗口、key/team/user 维度、include 等动态过滤仍由调用方
 * 决定传哪些参数，SQL 结构（GROUP BY、ORDER BY、聚合表达式、LIMIT）留在这里。
 * 可见性与 Session 游标那两组导出函数是「列条件片段」而不是查询入口：它们的调用方
 * （日志列表、详情、时间线）需要在同一条 drizzle 查询里拼接这些条件，片段因此必须由
 * 拥有表的仓储提供，业务模块不再 import 表符号。
 */

import { and, asc, desc, eq, gte, inArray, lt, lte, sql, type SQL } from "drizzle-orm";
import { BaseRepository } from "../core/db/BaseRepository";
import type { DrizzleDb } from "../core/db/Database";
import { liteLLM_ActiveRequests } from "../db/schema/activeRequests";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import {
	MIN_GENERATION_SHARE_FOR_TPS,
	MIN_GENERATION_WINDOW_MS,
	MIN_OUTPUT_TOKENS_FOR_SPEED,
	type SpeedBucket,
} from "../shared/ModelSpeed";
import { singletonFor } from "./internal/registry";

/**
 * Speed 时间桶的 UTC ISO 文本格式。
 *
 * 由 SQL 固化格式，避免驱动层把 timestamptz 返回成 Date 或“+00”这类省略分钟的偏移
 * 而被 V8 判成无效时间，整条曲线因此丢点。
 */
const SPEED_ISO_TEXT_FORMAT = '\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\'';

/** 单个「模型 × 供应商 × 时间桶」聚合结果（直接来自 SQL）。 */
export interface SpeedAggregateRow {
	/** 桶起点，SQL 已格式化为 UTC ISO 文本 */
	readonly bucket: string;
	/** 模型名 */
	readonly model: string;
	/** 实际执行请求的供应商原始值（custom_llm_provider）；cliproxy 行由 speedProviderIdentity 归一 */
	readonly provider: string | null;
	/** 桶内全部调用数（含不可测算的请求） */
	readonly calls: number;
	/** 桶内可测算请求数 */
	readonly requests: number;
	/** 桶内可测算请求的输出 token 合计；无样本时为 null */
	readonly output_tokens: number | null;
	/** 桶内可测算请求的生成秒数合计；无样本时为 null */
	readonly generation_seconds: number | null;
	/** 桶内可测算请求的输出 TPS 中位数；无样本时为 null */
	readonly p50_tps: number | null;
}

/** `/global/spend/report` 与各主体维度 `/spend/report` 共用的领域维度。 */
export type SpendReportDimension = "key" | "user" | "team" | "organization";

/**
 * 可见性条件片段：管理员看全部。
 *
 * 这两个片段与表无关，所以不挂在某张表的查询方法上；日志与活跃请求共用同一决策时，
 * 调用方两次拿到的是同一种「全可见/全不可见」条件，不会一处写成 TRUE、另一处漏写。
 */
export function visibleToAllClause(): SQL {
	return sql`TRUE`;
}

/** 可见性条件片段：没有任何可读范围。 */
export function visibleToNothingClause(): SQL {
	return sql`FALSE`;
}

/**
 * SpendLogs 的 team 维度可见性条件。
 * @param teamId - 目标团队
 */
export function spendTeamVisibilityClause(teamId: string): SQL {
	return eq(liteLLM_SpendLogs.team_id, teamId);
}

/**
 * SpendLogs 的 user 维度可见性条件。
 * @param userId - 目标用户
 */
export function spendUserVisibilityClause(userId: string): SQL {
	return eq(liteLLM_SpendLogs.user, userId);
}

/**
 * ActiveRequests 的 team 维度可见性条件；与 SpendLogs 侧同一决策映射到活跃表列。
 * @param teamId - 目标团队
 */
export function activeRequestTeamVisibilityClause(teamId: string): SQL {
	return eq(liteLLM_ActiveRequests.team_id, teamId);
}

/**
 * ActiveRequests 的 user 维度可见性条件。
 * @param userId - 目标用户
 */
export function activeRequestUserVisibilityClause(userId: string): SQL {
	return eq(liteLLM_ActiveRequests.user, userId);
}

/**
 * 由 `/global/activity` 的起止日构造半开窗口条件。
 *
 * end_date 在协议里是「包含在内的最后一天」，SQL 侧换成 `< endExclusive` 才能在
 * startTime 上用索引；若写成 `<= end + 1 天`，午夜整点的行会被算进第二天。
 * @param startDate - 起始日（UTC 零点）
 * @param endDate - 最后一天（包含）
 * @param internalUserId - 只统计该用户的调用；管理员不传
 */
function activityWindowClause(startDate: Date, endDate: Date, internalUserId: string | undefined): SQL | undefined {
	const endExclusive = new Date(endDate.getTime());
	endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
	const conditions: SQL[] = [sql`${liteLLM_SpendLogs.startTime} >= ${startDate}`, sql`${liteLLM_SpendLogs.startTime} < ${endExclusive}`];
	if (internalUserId !== undefined) {
		conditions.push(sql`${liteLLM_SpendLogs.user} = ${internalUserId}`);
	}
	return and(...conditions);
}

/**
 * 由可选起止时间构造 `startTime` 区间条件（含两端）。
 * @param startDate - 起始时间；缺省表示不设下界
 * @param endDate - 结束时间；缺省表示不设上界
 */
function startTimeRangeClause(startDate: Date | undefined, endDate: Date | undefined): SQL | undefined {
	if (startDate !== undefined && endDate !== undefined) {
		return and(sql`${liteLLM_SpendLogs.startTime} >= ${startDate}`, sql`${liteLLM_SpendLogs.startTime} <= ${endDate}`);
	}
	if (startDate !== undefined) {
		return sql`${liteLLM_SpendLogs.startTime} >= ${startDate}`;
	}
	if (endDate !== undefined) {
		return sql`${liteLLM_SpendLogs.startTime} <= ${endDate}`;
	}
	return undefined;
}

/** 只保留有供应商的行：空值代表本地/未识别来源，画进 provider 饼图会变成一条无名扇区。 */
function providerNotEmptyClause(): SQL {
	return sql`${liteLLM_SpendLogs.custom_llm_provider} IS NOT NULL AND ${liteLLM_SpendLogs.custom_llm_provider} != ''`;
}

/** `/spend/cost/request` 的列投影：刻意不含 api_key、metadata、messages 与上游请求正文。 */
const COST_REQUEST_SELECTION = {
	request_id: liteLLM_SpendLogs.request_id,
	spend: liteLLM_SpendLogs.spend,
	total_tokens: liteLLM_SpendLogs.total_tokens,
	prompt_tokens: liteLLM_SpendLogs.prompt_tokens,
	completion_tokens: liteLLM_SpendLogs.completion_tokens,
	cache_read_input_tokens: liteLLM_SpendLogs.cache_read_input_tokens,
	cache_creation_input_tokens: liteLLM_SpendLogs.cache_creation_input_tokens,
	startTime: liteLLM_SpendLogs.startTime,
	endTime: liteLLM_SpendLogs.endTime,
	request_duration_ms: liteLLM_SpendLogs.request_duration_ms,
	call_type: liteLLM_SpendLogs.call_type,
	model: liteLLM_SpendLogs.model,
	model_id: liteLLM_SpendLogs.model_id,
	model_group: liteLLM_SpendLogs.model_group,
	custom_llm_provider: liteLLM_SpendLogs.custom_llm_provider,
	endpoint: liteLLM_SpendLogs.endpoint,
	status: liteLLM_SpendLogs.status,
	key_alias: liteLLM_SpendLogs.key_alias,
	unit_prices: liteLLM_SpendLogs.unit_prices,
	peak_tier: liteLLM_SpendLogs.peak_tier,
} as const;

/**
 * 取得与数据库连接绑定的 Spend 聚合仓储。
 *
 * 没有缓存，因此单例只是省掉重复构造；同一连接上的端点共享实例，测试换连接即隔离。
 * @param db - Drizzle 数据库实例
 */
export const spendAggregationRepositoryFor = singletonFor((db: DrizzleDb) => new SpendAggregationRepository(db));

/**
 * 聚合/看板类只读查询实现。
 *
 * 不缓存；方法按「一个端点一次查询」拆分，调用方只传过滤参数与分页上限，
 * 不再拼 SQL、不再 import 表符号。
 */
export class SpendAggregationRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例（BaseRepository 构造为 protected，显式公开子类构造）
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	// ========== /global/activity ==========

	/**
	 * 按 UTC 日期汇总调用数与 token 数。
	 * @param startDate - 起始日（UTC 零点）
	 * @param endDate - 最后一天（包含）
	 * @param internalUserId - 只统计该用户的调用；管理员不传
	 * @returns 每个有数据日期的 `{ date, api_requests, total_tokens }`，按日期升序
	 */
	async dailyActivity(startDate: Date, endDate: Date, internalUserId?: string): Promise<Array<Record<string, unknown>>> {
		return await this._db
			.select({
				date: sql<string>`DATE(${liteLLM_SpendLogs.startTime})`,
				api_requests: sql<number>`COUNT(*)`,
				total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
			})
			.from(liteLLM_SpendLogs)
			.where(activityWindowClause(startDate, endDate, internalUserId))
			.groupBy(sql`DATE(${liteLLM_SpendLogs.startTime})`)
			.orderBy(asc(sql`DATE(${liteLLM_SpendLogs.startTime})`));
	}

	/**
	 * 按「模型组 × UTC 日期」汇总调用数与 token 数。
	 * @param startDate - 起始日（UTC 零点）
	 * @param endDate - 最后一天（包含）
	 * @param limit - 聚合行数上限，避免一次拉回整月的所有模型
	 * @param internalUserId - 只统计该用户的调用；管理员不传
	 * @returns 每个模型组每天的 `{ model_group, date, api_requests, total_tokens }`
	 */
	async modelDailyActivity(
		startDate: Date,
		endDate: Date,
		limit: number,
		internalUserId?: string,
	): Promise<Array<Record<string, unknown>>> {
		return await this._db
			.select({
				model_group: liteLLM_SpendLogs.model_group,
				date: sql<string>`DATE(${liteLLM_SpendLogs.startTime})`,
				api_requests: sql<number>`COUNT(*)`,
				total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
			})
			.from(liteLLM_SpendLogs)
			.where(activityWindowClause(startDate, endDate, internalUserId))
			.groupBy(liteLLM_SpendLogs.model_group, sql`DATE(${liteLLM_SpendLogs.startTime})`)
			.orderBy(asc(sql`DATE(${liteLLM_SpendLogs.startTime})`))
			.limit(limit);
	}

	// ========== /global/spend* ==========

	/**
	 * 全库累计花费与 token 合计。
	 * @returns 单行合计；表为空时 SUM 由 COALESCE 归零
	 */
	async globalTotals(): Promise<Record<string, unknown> | undefined> {
		const result = await this._db
			.select({
				total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
				total_prompt_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.prompt_tokens}), 0)`,
				total_completion_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.completion_tokens}), 0)`,
			})
			.from(liteLLM_SpendLogs);
		return result.at(0);
	}

	/**
	 * 按 API key 汇总花费与 token。
	 * @returns 每个 key 一行；不分页、不设 LIMIT（调用方按全量展示 Top Keys）
	 */
	async spendByApiKey(): Promise<Array<Record<string, unknown>>> {
		return await this._db
			.select({
				api_key: liteLLM_SpendLogs.api_key,
				total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
				total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
			})
			.from(liteLLM_SpendLogs)
			.groupBy(liteLLM_SpendLogs.api_key);
	}

	/**
	 * 按团队汇总花费与 token。
	 * @param limit - 团队行数上限
	 * @returns 每个 team_id 一行；未归属团队的日志被排除
	 */
	async teamSpendTotals(limit: number): Promise<Array<Record<string, unknown>>> {
		return await this._db
			.select({
				team_id: liteLLM_SpendLogs.team_id,
				total_spend: sql<number>`SUM(${liteLLM_SpendLogs.spend})`,
				total_tokens: sql<number>`SUM(${liteLLM_SpendLogs.total_tokens})`,
			})
			.from(liteLLM_SpendLogs)
			.where(sql`${liteLLM_SpendLogs.team_id} IS NOT NULL`)
			.groupBy(liteLLM_SpendLogs.team_id)
			.limit(limit);
	}

	/**
	 * 按「团队 × UTC 日期」汇总花费，用于每日花费矩阵。
	 * @param limit - 矩阵行数上限（按 date × team 笛卡尔积计算）
	 * @returns 每个团队每天一行，按日期降序；未归属团队的日志被排除
	 */
	async teamDailySpend(limit: number): Promise<Array<Record<string, unknown>>> {
		return await this._db
			.select({
				team_id: liteLLM_SpendLogs.team_id,
				date: sql<string>`DATE(${liteLLM_SpendLogs.startTime})`,
				spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
			})
			.from(liteLLM_SpendLogs)
			.where(sql`${liteLLM_SpendLogs.team_id} IS NOT NULL`)
			.groupBy(liteLLM_SpendLogs.team_id, sql`DATE(${liteLLM_SpendLogs.startTime})`)
			.orderBy(desc(sql`DATE(${liteLLM_SpendLogs.startTime})`))
			.limit(limit);
	}

	/**
	 * 按模型汇总花费与 token。
	 * @param limit - 模型行数上限
	 */
	async spendByModel(limit: number): Promise<Array<Record<string, unknown>>> {
		return await this._db
			.select({
				model: liteLLM_SpendLogs.model,
				total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
				total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
			})
			.from(liteLLM_SpendLogs)
			.groupBy(liteLLM_SpendLogs.model)
			.limit(limit);
	}

	/**
	 * 按供应商汇总花费与 token；空供应商不参与分组。
	 * @param limit - 供应商行数上限
	 */
	async spendByProvider(limit: number): Promise<Array<Record<string, unknown>>> {
		return await this._db
			.select({
				provider: liteLLM_SpendLogs.custom_llm_provider,
				total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
				total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
			})
			.from(liteLLM_SpendLogs)
			.where(providerNotEmptyClause())
			.groupBy(liteLLM_SpendLogs.custom_llm_provider)
			.limit(limit);
	}

	/**
	 * 按模型汇总区间内的花费、token 与请求数。
	 * @param startDate - 起始时间；缺省表示不设下界
	 * @param endDate - 结束时间；缺省表示不设上界
	 * @param limit - 模型行数上限
	 */
	async spendReportByModel(
		startDate: Date | undefined,
		endDate: Date | undefined,
		limit: number,
	): Promise<Array<Record<string, unknown>>> {
		return await this._db
			.select({
				model: liteLLM_SpendLogs.model,
				total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
				total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
				totalRequests: sql<number>`COUNT(*)`,
			})
			.from(liteLLM_SpendLogs)
			.where(startTimeRangeClause(startDate, endDate))
			.groupBy(liteLLM_SpendLogs.model)
			.orderBy(desc(sql`SUM(${liteLLM_SpendLogs.spend})`))
			.limit(limit);
	}

	/**
	 * 近 30 天每日花费（对齐 Python MonthlyGlobalSpend 视图：只返回有数据的日期，不做零填充）。
	 *
	 * 行内字段随过滤维度变化，与 Python 的三个视图一一对应：
	 * - 无过滤 → 只有 `{ date, spend }`；
	 * - 传 apiKey → 补 `api_key`；
	 * - 传 internalUserId → 补 `api_key` 与 `user`（internal_user 只能看自己）。
	 * @param apiKey - 只统计该 API key；缺省不过滤
	 * @param internalUserId - 只统计该用户的调用；管理员不传
	 */
	async dailySpendForLast30Days(apiKey: string | undefined, internalUserId: string | undefined): Promise<Array<Record<string, unknown>>> {
		const conditions: SQL[] = [sql`${liteLLM_SpendLogs.startTime} >= (CURRENT_DATE - INTERVAL '30 days')`];
		if (apiKey !== undefined) {
			conditions.push(eq(liteLLM_SpendLogs.api_key, apiKey));
		}
		if (internalUserId !== undefined) {
			conditions.push(eq(liteLLM_SpendLogs.user, internalUserId));
		}
		const whereClause = and(...conditions);
		const dateExpr = sql<string>`DATE(${liteLLM_SpendLogs.startTime})`;
		const spendExpr = sql<number>`SUM(${liteLLM_SpendLogs.spend})`;

		if (internalUserId !== undefined) {
			return await this._db
				.select({
					date: dateExpr,
					spend: spendExpr,
					api_key: liteLLM_SpendLogs.api_key,
					user: liteLLM_SpendLogs.user,
				})
				.from(liteLLM_SpendLogs)
				.where(whereClause)
				.groupBy(dateExpr, liteLLM_SpendLogs.api_key, liteLLM_SpendLogs.user)
				.orderBy(asc(dateExpr));
		}

		if (apiKey !== undefined) {
			return await this._db
				.select({
					date: dateExpr,
					spend: spendExpr,
					api_key: liteLLM_SpendLogs.api_key,
				})
				.from(liteLLM_SpendLogs)
				.where(whereClause)
				.groupBy(dateExpr, liteLLM_SpendLogs.api_key)
				.orderBy(asc(dateExpr));
		}

		return await this._db
			.select({
				date: dateExpr,
				spend: spendExpr,
			})
			.from(liteLLM_SpendLogs)
			.where(whereClause)
			.groupBy(dateExpr)
			.orderBy(asc(dateExpr));
	}

	/**
	 * 按供应商汇总区间花费（`/global/spend/provider` 单数形式）。
	 *
	 * 与 `/providers` 的差别是协议历史：只有起止日期同时存在时才收窄，单侧参数被忽略。
	 * @param startDate - 起始时间；与 endDate 同时存在时才生效
	 * @param endDate - 结束时间；与 startDate 同时存在时才生效
	 * @param limit - 供应商行数上限
	 */
	async spendByProviderInRange(
		startDate: Date | undefined,
		endDate: Date | undefined,
		limit: number,
	): Promise<Array<Record<string, unknown>>> {
		const whereClause = startDate !== undefined && endDate !== undefined ? startTimeRangeClause(startDate, endDate) : undefined;
		return await this._db
			.select({
				provider: liteLLM_SpendLogs.custom_llm_provider,
				total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
			})
			.from(liteLLM_SpendLogs)
			.where(whereClause === undefined ? providerNotEmptyClause() : and(whereClause, providerNotEmptyClause()))
			.groupBy(liteLLM_SpendLogs.custom_llm_provider)
			.limit(limit);
	}

	/**
	 * 按请求标签汇总花费与 token。
	 *
	 * 只有起止日期同时存在时才收窄；单侧参数被忽略，与 `/global/spend/tags` 的既有行为一致。
	 * @param startDate - 起始时间；与 endDate 同时存在时才生效
	 * @param endDate - 结束时间；与 startDate 同时存在时才生效
	 * @param limit - 标签行数上限
	 */
	async spendByTag(startDate: Date | undefined, endDate: Date | undefined, limit: number): Promise<Array<Record<string, unknown>>> {
		const conditions: SQL[] = [sql`${liteLLM_SpendLogs.request_tags} IS NOT NULL`];
		if (startDate !== undefined && endDate !== undefined) {
			conditions.push(sql`${liteLLM_SpendLogs.startTime} >= ${startDate}`);
			conditions.push(sql`${liteLLM_SpendLogs.startTime} <= ${endDate}`);
		}
		return await this._db
			.select({
				tag: liteLLM_SpendLogs.request_tags,
				total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
				total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
			})
			.from(liteLLM_SpendLogs)
			.where(conditions.length > 1 ? and(...conditions) : conditions[0])
			.groupBy(liteLLM_SpendLogs.request_tags)
			.limit(limit);
	}

	/**
	 * 读取出现过的请求标签名（去重）。
	 * @param limit - 标签行数上限
	 */
	async requestTagNames(limit: number): Promise<Array<{ tag: unknown }>> {
		return await this._db
			.selectDistinct({ tag: liteLLM_SpendLogs.request_tags })
			.from(liteLLM_SpendLogs)
			.where(sql`${liteLLM_SpendLogs.request_tags} IS NOT NULL`)
			.limit(limit);
	}

	/**
	 * 按终端用户汇总花费与 token；空 end_user 被排除。
	 *
	 * 只有起止时间同时存在时才收窄；单侧参数被忽略，与 `/global/spend/end_users` 一致。
	 * @param startTime - 起始时间；与 endTime 同时存在时才生效
	 * @param endTime - 结束时间；与 startTime 同时存在时才生效
	 * @param limit - 终端用户行数上限
	 */
	async spendByEndUser(startTime: Date | undefined, endTime: Date | undefined, limit: number): Promise<Array<Record<string, unknown>>> {
		const conditions: SQL[] = [sql`${liteLLM_SpendLogs.end_user} IS NOT NULL AND ${liteLLM_SpendLogs.end_user} != ''`];
		if (startTime !== undefined && endTime !== undefined) {
			conditions.push(sql`${liteLLM_SpendLogs.startTime} >= ${startTime}`);
			conditions.push(sql`${liteLLM_SpendLogs.startTime} <= ${endTime}`);
		}
		return await this._db
			.select({
				end_user: liteLLM_SpendLogs.end_user,
				total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
				total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
			})
			.from(liteLLM_SpendLogs)
			.where(conditions.length > 1 ? and(...conditions) : conditions[0])
			.groupBy(liteLLM_SpendLogs.end_user)
			.limit(limit);
	}

	// ========== /spend/cost（虚拟密钥自助查询） ==========

	/**
	 * 按 request_id + API key 读取单条日志的成本行。
	 *
	 * 两个条件缺一不可：api_key 列存的是虚拟密钥的 token 哈希，带上它才能把范围固定在
	 * 调用方自己的 key 上；否则知道 request_id 的人能读到别家公司的账单。
	 * @param requestId - SpendLogs.request_id（客户端 id 已由调用方换算）
	 * @param apiKey - 调用方 key 的哈希
	 * @returns 命中行或 undefined（不存在与不属于本 key 走同一出口）
	 */
	async findCostRequest(requestId: string, apiKey: string): Promise<Record<string, unknown> | undefined> {
		const rows = await this._db
			.select(COST_REQUEST_SELECTION)
			.from(liteLLM_SpendLogs)
			.where(and(eq(liteLLM_SpendLogs.request_id, requestId), eq(liteLLM_SpendLogs.api_key, apiKey)))
			.limit(1);
		return rows.at(0) as unknown as Record<string, unknown> | undefined;
	}

	/**
	 * 汇总一把 key 在时间窗口内的花费与 token。
	 *
	 * SUM 显式转 double precision 并 mapWith(Number)：pg 驱动会把 numeric/bigint 聚合返回成
	 * 字符串，直接在调用方 `.toFixed` 会得到 NaN，对账就失去意义。
	 * @param apiKey - 调用方 key 的哈希
	 * @param start - 窗口起点（含）
	 * @param end - 窗口终点（不含）
	 * @param model - 只汇总该模型；缺省不过滤
	 * @returns 汇总行；没有命中时仍返回一行零值（由聚合函数保证）
	 */
	async summarizeCost(apiKey: string, start: Date, end: Date, model?: string): Promise<Record<string, unknown> | undefined> {
		const conditions: SQL[] = [
			eq(liteLLM_SpendLogs.api_key, apiKey),
			gte(liteLLM_SpendLogs.startTime, start),
			lt(liteLLM_SpendLogs.startTime, end),
		];
		if (model !== undefined) {
			conditions.push(eq(liteLLM_SpendLogs.model, model));
		}
		const rows = await this._db
			.select({
				total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)::double precision`.mapWith(Number),
				total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)::double precision`.mapWith(Number),
				prompt_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.prompt_tokens}), 0)::double precision`.mapWith(Number),
				completion_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.completion_tokens}), 0)::double precision`.mapWith(Number),
				cache_read_input_tokens:
					sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.cache_read_input_tokens}), 0)::double precision`.mapWith(Number),
				cache_creation_input_tokens:
					sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.cache_creation_input_tokens}), 0)::double precision`.mapWith(Number),
				requests: sql<number>`COUNT(*)::int`.mapWith(Number),
				first_start: sql<Date | null>`MIN(${liteLLM_SpendLogs.startTime})`,
				last_end: sql<Date | null>`MAX(${liteLLM_SpendLogs.endTime})`,
			})
			.from(liteLLM_SpendLogs)
			.where(and(...conditions));
		return rows.at(0) as unknown as Record<string, unknown> | undefined;
	}

	/**
	 * 合并口径的会话键：公司客户端把 Harness 会话 UUID 写进 metadata，数据库生成列
	 * `session_group_key` 统一成 `s:<uuid>`；这里对旧行保留空串而不是丢掉整行。
	 */
	private _costSessionKey(): SQL<string> {
		return sql<string>`COALESCE(${liteLLM_SpendLogs.session_group_key}, '')`;
	}

	/**
	 * 按会话汇总一把 key 在窗口内的花费、token 与请求数。
	 *
	 * 会话可能横跨多个 Run，因此窗口仍由调用方给；结果只暴露会话标识和账单事实，
	 * 不返回 metadata、messages 或 api_key，避免把会话正文带进成本接口。
	 * @param apiKey - 调用方 key 的哈希
	 * @param start - 窗口起点（含）
	 * @param end - 窗口终点（不含）
	 * @param limit - 会话行数上限
	 * @returns 每个会话的聚合行，最近活跃的在前
	 */
	async listCostSessions(apiKey: string, start: Date, end: Date, limit: number): Promise<Array<Record<string, unknown>>> {
		const sessionKey = this._costSessionKey();
		return (await this._db
			.select({
				session_group_key: sessionKey,
				requests: sql<number>`COUNT(*)::int`.mapWith(Number),
				total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)::double precision`.mapWith(Number),
				total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)::double precision`.mapWith(Number),
				prompt_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.prompt_tokens}), 0)::double precision`.mapWith(Number),
				completion_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.completion_tokens}), 0)::double precision`.mapWith(Number),
				cache_read_input_tokens:
					sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.cache_read_input_tokens}), 0)::double precision`.mapWith(Number),
				cache_creation_input_tokens:
					sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.cache_creation_input_tokens}), 0)::double precision`.mapWith(Number),
				models: sql<
					string[]
				>`COALESCE(array_agg(DISTINCT ${liteLLM_SpendLogs.model_group}) FILTER (WHERE ${liteLLM_SpendLogs.model_group} IS NOT NULL AND ${liteLLM_SpendLogs.model_group} != ''), ARRAY[]::text[])`,
				first_request_at: sql<Date | null>`MIN(${liteLLM_SpendLogs.startTime})`,
				last_request_at: sql<Date | null>`MAX(${liteLLM_SpendLogs.endTime})`,
			})
			.from(liteLLM_SpendLogs)
			.where(
				and(eq(liteLLM_SpendLogs.api_key, apiKey), gte(liteLLM_SpendLogs.startTime, start), lt(liteLLM_SpendLogs.startTime, end)),
			)
			.groupBy(sessionKey)
			.orderBy(desc(sql`MAX(${liteLLM_SpendLogs.startTime})`))
			.limit(limit)) as unknown as Array<Record<string, unknown>>;
	}

	/**
	 * 汇总一把 key 的单个会话在时间窗口内的账单事实。
	 * @param apiKey - 调用方 key 的哈希
	 * @param sessionGroupKey - 数据库规范会话键（例如 `s:<uuid>`）
	 * @param start - 请求开始时间下界（含）；缺省不设
	 * @param end - 请求开始时间上界（含）；缺省不设
	 */
	async summarizeCostSession(
		apiKey: string,
		sessionGroupKey: string,
		start?: Date,
		end?: Date,
	): Promise<Record<string, unknown> | undefined> {
		const conditions: SQL[] = [eq(liteLLM_SpendLogs.api_key, apiKey), eq(liteLLM_SpendLogs.session_group_key, sessionGroupKey)];
		if (start !== undefined) {
			conditions.push(gte(liteLLM_SpendLogs.startTime, start));
		}
		if (end !== undefined) {
			conditions.push(lte(liteLLM_SpendLogs.startTime, end));
		}
		const rows = await this._db
			.select({
				requests: sql<number>`COUNT(*)::int`.mapWith(Number),
				total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)::double precision`.mapWith(Number),
				total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)::double precision`.mapWith(Number),
				prompt_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.prompt_tokens}), 0)::double precision`.mapWith(Number),
				completion_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.completion_tokens}), 0)::double precision`.mapWith(Number),
				cache_read_input_tokens:
					sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.cache_read_input_tokens}), 0)::double precision`.mapWith(Number),
				cache_creation_input_tokens:
					sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.cache_creation_input_tokens}), 0)::double precision`.mapWith(Number),
				models: sql<
					string[]
				>`COALESCE(array_agg(DISTINCT ${liteLLM_SpendLogs.model_group}) FILTER (WHERE ${liteLLM_SpendLogs.model_group} IS NOT NULL AND ${liteLLM_SpendLogs.model_group} != ''), ARRAY[]::text[])`,
				first_request_at: sql<Date | null>`MIN(${liteLLM_SpendLogs.startTime})`,
				last_request_at: sql<Date | null>`MAX(${liteLLM_SpendLogs.endTime})`,
			})
			.from(liteLLM_SpendLogs)
			.where(and(...conditions));
		return rows.at(0) as unknown as Record<string, unknown> | undefined;
	}

	/**
	 * 读取单个会话在窗口内的请求账单行。
	 *
	 * 投影复用 `/spend/cost/request` 的白名单，只多给会话键；正文与上游请求仍不返回。
	 * @param apiKey - 调用方 key 的哈希
	 * @param sessionGroupKey - 数据库规范会话键
	 * @param start - 请求开始时间下界（含）
	 * @param end - 请求开始时间上界（含）
	 * @param limit - 行数上限
	 */
	async listCostSessionRequests(
		apiKey: string,
		sessionGroupKey: string,
		start: Date,
		end: Date,
		limit: number,
	): Promise<Array<Record<string, unknown>>> {
		return (await this._db
			.select(COST_REQUEST_SELECTION)
			.from(liteLLM_SpendLogs)
			.where(
				and(
					eq(liteLLM_SpendLogs.api_key, apiKey),
					eq(liteLLM_SpendLogs.session_group_key, sessionGroupKey),
					gte(liteLLM_SpendLogs.startTime, start),
					lte(liteLLM_SpendLogs.startTime, end),
				),
			)
			.orderBy(asc(liteLLM_SpendLogs.startTime), asc(liteLLM_SpendLogs.request_id))
			.limit(limit)) as unknown as Array<Record<string, unknown>>;
	}

	// ========== /key|user|team|organization/spend/report ==========

	/**
	 * 按主体维度汇总区间内每个模型的花费、token 与请求数。
	 *
	 * 维度到列的映射留在仓储：维度是仓储的领域概念，调用方只传维度名与主体值，
	 * 不再为了拼条件而 import 表列。
	 * @param dimension - 记账维度
	 * @param id - 主体值；管理员不传表示跨主体汇总
	 * @param start - 区间起点（含）
	 * @param end - 区间终点（不含）
	 * @param limit - 行数上限（调用方用「超出一行即报错」提示收窄区间）
	 * @param model - 只统计该模型；缺省不过滤
	 */
	async scopedSpendReport(
		dimension: SpendReportDimension,
		id: string | undefined,
		start: Date,
		end: Date,
		limit: number,
		model?: string,
	): Promise<Array<Record<string, unknown>>> {
		const conditions: SQL[] = [gte(liteLLM_SpendLogs.startTime, start), lt(liteLLM_SpendLogs.startTime, end)];
		if (model !== undefined) {
			conditions.push(eq(liteLLM_SpendLogs.model, model));
		}
		if (id !== undefined) {
			conditions.push(this._dimensionColumn(dimension, id));
		}
		return await this._db
			.select({
				model: liteLLM_SpendLogs.model,
				total_spend: sql<number>`SUM(${liteLLM_SpendLogs.spend})`,
				total_tokens: sql<number>`SUM(${liteLLM_SpendLogs.total_tokens})`.mapWith(Number),
				total_requests: sql<number>`COUNT(*)`.mapWith(Number),
			})
			.from(liteLLM_SpendLogs)
			.where(and(...conditions))
			.groupBy(liteLLM_SpendLogs.model)
			.orderBy(desc(sql`SUM(${liteLLM_SpendLogs.spend})`))
			.limit(limit);
	}

	// ========== /global/model_speed ==========

	/**
	 * 按「模型 × 供应商 × 时区时间桶」聚合输出 TPS 的分子、分母与中位数。
	 *
	 * SQL 里做两件容易出错、必须与原实现保持一致的事：
	 * - 归属模型：有 deployment（model_id）时它就是实际执行的模型，否则退回
	 *   `metadata->>'resolved_model_group'`；只在 model_id 为空的行上读 metadata，
	 *   避免为分组 detoast 全部 JSON。
	 * - 时间桶：startTime 是 UTC 的 timestamp without time zone，先还原成 UTC 时刻，
	 *   再换到调用方时区做 date_trunc，最后换回 UTC；这样「每天」对齐当地午夜。
	 * @param startDate - 起始自然日（调用方时区，YYYY-MM-DD）
	 * @param endDateExclusive - 结束自然日的次日（调用方时区，YYYY-MM-DD）
	 * @param bucket - 时间桶粒度
	 * @param timezone - 已校验的 IANA 时区名
	 * @param internalUserId - 只统计该用户的调用；管理员不传
	 * @returns 每个桶一行的聚合结果
	 */
	async aggregateModelSpeed(
		startDate: string,
		endDateExclusive: string,
		bucket: SpeedBucket,
		timezone: string,
		internalUserId?: string,
	): Promise<SpeedAggregateRow[]> {
		// eligible 与 Logs 页「TPS → Output」同一门槛：输出足够长，且首字之后确实还有
		// 可测量的生成窗口。比例挡住「长请求里的几毫秒窗口」，绝对下限挡住「短请求里的
		// 几十毫秒窗口」——后者按比例看仍然合法，算出来却是上万 TPS，属于上游一次性写出的
		// 交付毛刺，不是模型速度。
		const generationWindowExpr = sql`EXTRACT(EPOCH FROM (${liteLLM_SpendLogs.endTime} - ${liteLLM_SpendLogs.completionStartTime}))`;
		const requestDurationExpr = sql`EXTRACT(EPOCH FROM (${liteLLM_SpendLogs.endTime} - ${liteLLM_SpendLogs.startTime}))`;
		const eligible = sql`(${liteLLM_SpendLogs.completion_tokens} >= ${MIN_OUTPUT_TOKENS_FOR_SPEED}
			AND ${liteLLM_SpendLogs.completionStartTime} IS NOT NULL
			AND ${liteLLM_SpendLogs.completionStartTime} > ${liteLLM_SpendLogs.startTime}
			AND ${liteLLM_SpendLogs.completionStartTime} < ${liteLLM_SpendLogs.endTime}
			AND ${generationWindowExpr} >= ${MIN_GENERATION_SHARE_FOR_TPS} * ${requestDurationExpr}
			AND ${generationWindowExpr} >= ${MIN_GENERATION_WINDOW_MS / 1000})`;
		// 分子分母都下发原始合计，桶内平均与跨桶平均都按生成秒数加权；只在 SQL 里逐行算
		// TPS 再平均，会让短请求与长请求等权。中位数仍是逐请求指标，按行排序取分位。
		// 统一格式化成 UTC ISO 文本：驱动层对 timestamptz 的返回类型不一致（Date 或文本），
		// 由 SQL 固化格式后前端才能稳定解析。
		const attributedModelExpr = sql`CASE
				WHEN COALESCE(${liteLLM_SpendLogs.model_id}, '') <> '' THEN ${liteLLM_SpendLogs.model}
				ELSE COALESCE(NULLIF(${liteLLM_SpendLogs.metadata}->>'resolved_model_group', ''), ${liteLLM_SpendLogs.model})
			END`;
		const bucketTextExpr = sql`to_char((date_trunc(${bucket}::text, (${liteLLM_SpendLogs.startTime} AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}::text)) AT TIME ZONE ${timezone}::text) AT TIME ZONE 'UTC', ${sql.raw(SPEED_ISO_TEXT_FORMAT)})`;

		// 区间边界：把调用方时区的自然日换算成 UTC 的 timestamp without time zone。
		// 右侧是常量表达式，startTime 索引仍然可用。
		const startBound = sql`((${startDate}::timestamp AT TIME ZONE ${timezone}::text) AT TIME ZONE 'UTC')`;
		const endBound = sql`((${endDateExclusive}::timestamp AT TIME ZONE ${timezone}::text) AT TIME ZONE 'UTC')`;

		const conditions: SQL[] = [sql`${liteLLM_SpendLogs.startTime} >= ${startBound}`, sql`${liteLLM_SpendLogs.startTime} < ${endBound}`];
		// internal_user / internal_user_viewer 只能看到自己产生的调用，与其他 /global 端点一致
		if (internalUserId !== undefined) {
			conditions.push(eq(liteLLM_SpendLogs.user, internalUserId));
		}

		// Speed 的原始行分两条来源：
		// - 有 deployment（99% 的行）只读普通列，可走覆盖索引的 index-only scan；
		// - 没有 deployment 的行（约 1%）才读 metadata 的 resolved_model_group。
		// 两段 UNION ALL 后再聚合，p50 仍在完整样本上计算，不是两个分位数的加权近似。
		const hasDeployment = sql`COALESCE(${liteLLM_SpendLogs.model_id}, '') <> ''`;
		const lacksDeployment = sql`COALESCE(${liteLLM_SpendLogs.model_id}, '') = ''`;
		const providerExpr = sql`COALESCE(${liteLLM_SpendLogs.custom_llm_provider}, '')`;
		const speedRowSelect = (model: SQL, predicate: SQL): SQL => sql`
			SELECT
				${bucketTextExpr} AS bucket,
				${model} AS model,
				${providerExpr} AS provider,
				CASE WHEN ${eligible} THEN ${liteLLM_SpendLogs.completion_tokens}::double precision END AS output_tokens,
				CASE WHEN ${eligible} THEN ${generationWindowExpr} END AS generation_seconds
			FROM ${liteLLM_SpendLogs}
			WHERE ${and(...conditions, predicate)!}
		`;
		const speedRowsQuery = sql`
			WITH speed_rows AS (
				${speedRowSelect(sql`${liteLLM_SpendLogs.model}`, hasDeployment)}
				UNION ALL
				${speedRowSelect(attributedModelExpr, lacksDeployment)}
			)
			SELECT
				bucket,
				model,
				provider,
				(COUNT(*))::int AS calls,
				(COUNT(*) FILTER (WHERE generation_seconds IS NOT NULL))::int AS requests,
				SUM(output_tokens) AS output_tokens,
				SUM(generation_seconds) AS generation_seconds,
				(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY output_tokens / generation_seconds) FILTER (WHERE generation_seconds IS NOT NULL)) AS p50_tps
			FROM speed_rows
			GROUP BY 1, 2, 3
		`;
		const speedResult = (await this._db.execute(speedRowsQuery)) as unknown as { rows: SpeedAggregateRow[] };
		return speedResult.rows;
	}

	/**
	 * 生成完整的时间桶时间轴（包含没有数据的桶）。
	 *
	 * generate_series 走「当地墙钟」，再换回 UTC，夏令时切换日的 23/25 小时也能对齐；
	 * 页面用它补齐空档、在缺口处断线，否则前端会把相邻两点直接连起来，看起来像「那些
	 * 时段也有数据」。
	 * @param startDate - 起始自然日（调用方时区，YYYY-MM-DD）
	 * @param endDateExclusive - 结束自然日的次日（调用方时区，YYYY-MM-DD）
	 * @param bucket - 时间桶粒度
	 * @param timezone - 已校验的 IANA 时区名
	 * @returns 每个桶起点的 UTC ISO 文本（列名 bucket_start）
	 */
	async speedBucketAxis(
		startDate: string,
		endDateExclusive: string,
		bucket: SpeedBucket,
		timezone: string,
	): Promise<Array<{ bucket_start: string }>> {
		const step = bucket === "hour" ? sql.raw("interval '1 hour'") : sql.raw("interval '1 day'");
		const axisResult = (await this._db.execute(sql`
			SELECT to_char(
				(series.bucket_local AT TIME ZONE ${timezone}::text) AT TIME ZONE 'UTC',
				${sql.raw(SPEED_ISO_TEXT_FORMAT)}
			) AS bucket_start
			FROM generate_series(
				${startDate}::timestamp,
				${endDateExclusive}::timestamp - interval '1 second',
				${step}
			) AS series(bucket_local)
		`)) as unknown as { rows: Array<{ bucket_start: string }> };
		return axisResult.rows;
	}

	// ========== 可见性 ==========

	/**
	 * 把一批 request_id 裁剪到当前调用方可见的集合。
	 *
	 * 已结算日志与活动请求同时查：详情/批量详情是直接按 request_id 读的，只在列表上做
	 * 可见性仍能让知道 ID 的低权限调用方绕过列表读到别人的正文。两个查询并发发出，
	 * 与迁移前的等待顺序一致（先已结算、后活动请求）。
	 * @param requestIds - 待检查的 request_id（调用方已去重并保证非空）
	 * @param spendClause - SpendLogs 的可见性条件
	 * @param activeClause - ActiveRequests 的可见性条件
	 * @returns 可见 request_id 集合
	 */
	async listVisibleRequestIds(requestIds: readonly string[], spendClause: SQL, activeClause: SQL): Promise<Set<string>> {
		const [settled, active] = await Promise.all([
			this._db
				.select({ request_id: liteLLM_SpendLogs.request_id })
				.from(liteLLM_SpendLogs)
				.where(and(inArray(liteLLM_SpendLogs.request_id, [...requestIds]), spendClause)),
			this._db
				.select({ request_id: liteLLM_ActiveRequests.request_id })
				.from(liteLLM_ActiveRequests)
				.where(and(inArray(liteLLM_ActiveRequests.request_id, [...requestIds]), activeClause)),
		]);
		const visible = new Set<string>();
		for (const row of settled) {
			if (typeof row.request_id === "string") {
				visible.add(row.request_id);
			}
		}
		for (const row of active) {
			if (typeof row.request_id === "string") {
				visible.add(row.request_id);
			}
		}
		return visible;
	}

	/**
	 * 把主体维度映射为 SpendLogs 的过滤条件。
	 * @param dimension - 记账维度
	 * @param id - 主体值
	 * @returns 对应列的等值条件
	 * @throws {Error} 维度不在四个受支持主体内时（调用方传错维度属于编程错误，不静默退化为全量）
	 */
	private _dimensionColumn(dimension: SpendReportDimension, id: string): SQL {
		switch (dimension) {
			case "key":
				return eq(liteLLM_SpendLogs.api_key, id);
			case "user":
				return eq(liteLLM_SpendLogs.user, id);
			case "team":
				return eq(liteLLM_SpendLogs.team_id, id);
			case "organization":
				return eq(liteLLM_SpendLogs.organization_id, id);
			default:
				throw new Error(`未知的花费维度: ${String(dimension)}`);
		}
	}
}
