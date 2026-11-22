/**
 * Spend 报表只读仓储 —— `LiteLLM_SpendLogs` 与 `LiteLLM_ActiveRequests` 的读模型。
 *
 * 记账链路（写入、结算、在途登记、块表）由记账侧的仓储负责；本文件只承载 Dashboard
 * 与日志列表读取侧原先散落在各端点里的查询。两条读模型读同一批表但语义不同：写入侧
 * 关心「一次请求怎样落账」，读取侧关心「按调用方过滤后怎样分页、聚合与回表」，因此
 * 各自维护一份，读模型改投影不会碰到结算事务。
 *
 * 两条约束决定了这里的形态：
 *   - 记账数据量大且随时变化，整表或按键缓存都会把「刚结束的请求还看不见」变成常态，
 *     所以这里每个方法都直接查库，不挂 `TableCache` / `EntryCache`。
 *   - 分页与投影的 SQL 形状被测试和线上索引共同锁定（投影列名、`(startTime, request_id)`
 *     兜底排序、先取行键再回表），迁移时整段 SQL 原样搬进来，只把过滤参数变成入参，
 *     不改语义、不改返回行形状。
 */

import { and, asc, eq, gt, inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { BaseRepository } from "../core/db/BaseRepository";
import type { DrizzleDb } from "../core/db/Database";
import { createModuleLogger } from "../core/utils/logger";
import { liteLLM_ActiveRequests } from "../db/schema/activeRequests";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { normalizeSessionUuid } from "../spend/sessionIdentity";
import type { SessionPosition } from "../spend/sessionPosition";
import { spendLogStatusSql } from "../spend/spendLogStatus";
import {
	spendLogDurationSql,
	spendLogExecutionModelSql,
	spendLogListMetadataSql,
	spendLogMetadataJsonSql,
	streamRequestedSql,
} from "../spend/spendLogProjections";
import { singletonFor } from "./internal/registry";

const logger = createModuleLogger("SpendReportingRepository");

/** 排序方向；取值与接口层 `SpendSortOrder` 的字符串值一致。 */
export type SpendSortDirection = "asc" | "desc";

/** `/spend/logs/ui` 与 `/spend/logs/v2` 允许的排序列（与 Python LiteLLM 白名单一致）。 */
export type SpendLogSortField = "spend" | "total_tokens" | "startTime" | "endTime" | "request_duration_ms";

/**
 * UI 日志列表的过滤条件。
 *
 * 字段名沿用接口层的 query 语义（`user` 对应 `user_id` 参数）；两个 where 构造器共用
 * 同一份入参，保证「进行中」与「已落库」两侧的过滤口径始终一致。
 */
export interface UiSpendLogsWhereArgs {
	/** 下界；缺省表示不限下界（Dashboard 的 All Time）。 */
	readonly startDate?: Date;
	/** 上界；缺省表示不限上界。 */
	readonly endDate?: Date;
	/** 团队过滤。 */
	readonly teamId?: string;
	/** 密钥过滤（哈希后的 token）。 */
	readonly apiKey?: string;
	/** 用户过滤。 */
	readonly user?: string;
	/** 单请求过滤。 */
	readonly requestId?: string;
	/** 模型执行名过滤。 */
	readonly model?: string;
	/** 部署（model_id）过滤。 */
	readonly modelId?: string;
	/** 终端用户过滤。 */
	readonly endUser?: string;
	/** 会话 ID（完整 UUID 走规范键，其余保留包含匹配）。 */
	readonly sessionId?: string;
	/** 状态过滤（`success` 兼容历史 NULL 行）。 */
	readonly statusFilter?: string;
	/** 最小 spend。 */
	readonly minSpend?: number;
	/** 最大 spend。 */
	readonly maxSpend?: number;
	/** 密钥别名（包含匹配）。 */
	readonly keyAlias?: string;
	/** 错误码（精确匹配）。 */
	readonly errorCode?: string;
	/** 错误信息（包含匹配，仍读 metadata）。 */
	readonly errorMessage?: string;
}

/** UI 列表行定位：来源表 + 主键，投影推迟到取回当前页之后。 */
export interface UiPageRowKey {
	/** 请求 ID */
	readonly request_id: string;
	/** 该行来自哪张表 */
	readonly source: "active" | "spend";
}

/** 分页键 + 排序键；两张表都用同一组字段确定混排顺序。 */
interface UiPageRowKeyWithTime extends UiPageRowKey {
	/** 行在时间轴上的位置，用于两路归并 */
	readonly startTime: Date;
}

/**
 * 取得与数据库连接绑定的仓储。
 *
 * 用工厂而不是 `new`：读模型不持有状态，但同一连接上的调用方共享同一实例可以少建对象，
 * 也让「哪个仓储负责哪张表」在装配处一眼可见。
 * @param db - Drizzle 数据库实例
 */
export const spendReportingRepositoryFor = singletonFor((db: DrizzleDb) => new SpendReportingRepository(db));

/**
 * Spend 报表只读仓储。
 *
 * 所有方法只读：没有 upsert / 写穿 / 失效，也就不需要缓存。
 */
export class SpendReportingRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	// ────────────────────────── 会话定位子句 ──────────────────────────

	/**
	 * 会话分组的已落库条件。
	 * @param groupKey - 规范会话键（`s:` / `c:` 前缀）
	 * @returns `session_group_key = $1`
	 */
	sessionGroupClause(groupKey: string): SQL {
		return eq(liteLLM_SpendLogs.session_group_key, groupKey);
	}

	/**
	 * 快照锚点：只取位置不晚于快照的那一段，保证同一快照下的分页结果稳定。
	 * @param position - 快照位置
	 * @returns `(startTime, request_id) <= (snapshotStartTime, snapshotRequestId)`
	 */
	sessionSnapshotClause(position: SessionPosition): SQL {
		return sql`(${liteLLM_SpendLogs.startTime}, ${liteLLM_SpendLogs.request_id}) <= (${position.startTime}, ${position.requestId})`;
	}

	/**
	 * 正向游标：只取该位置之后的请求。
	 * @param position - 游标位置
	 * @returns `(startTime, request_id) > (cursorStartTime, cursorRequestId)`
	 */
	sessionCursorClause(position: SessionPosition): SQL {
		return sql`(${liteLLM_SpendLogs.startTime}, ${liteLLM_SpendLogs.request_id}) > (${position.startTime}, ${position.requestId})`;
	}

	/**
	 * 反向翻页：只取该位置之前的请求。
	 * @param position - 游标位置
	 * @returns `(startTime, request_id) < (cursorStartTime, cursorRequestId)`
	 */
	sessionBeforeClause(position: SessionPosition): SQL {
		return sql`(${liteLLM_SpendLogs.startTime}, ${liteLLM_SpendLogs.request_id}) < (${position.startTime}, ${position.requestId})`;
	}

	// ────────────────────────── where 构造 ──────────────────────────

	/**
	 * 构造 `/spend/logs/ui` 与 `/spend/logs/v2` 共用的已落库过滤条件。
	 *
	 * 对齐 Python `ui_view_spend_logs` 的拼接顺序；条件顺序影响索引选择，迁移时保持原样。
	 * @param args - 过滤参数
	 * @returns 组合后的 where 条件
	 */
	uiSpendLogsWhereClause(args: UiSpendLogsWhereArgs): SQL | undefined {
		const conditions: SQL[] = [];
		if (args.startDate !== undefined) {
			conditions.push(sql`${liteLLM_SpendLogs.startTime} >= ${args.startDate}`);
		}
		if (args.endDate !== undefined) {
			conditions.push(sql`${liteLLM_SpendLogs.startTime} <= ${args.endDate}`);
		}
		if (args.teamId !== undefined) {
			conditions.push(eq(liteLLM_SpendLogs.team_id, args.teamId));
		}
		if (args.apiKey !== undefined) {
			conditions.push(eq(liteLLM_SpendLogs.api_key, args.apiKey));
		}
		if (args.user !== undefined) {
			conditions.push(eq(liteLLM_SpendLogs.user, args.user));
		}
		if (args.requestId !== undefined) {
			conditions.push(eq(liteLLM_SpendLogs.request_id, args.requestId));
		}
		if (args.model !== undefined) {
			conditions.push(eq(spendLogExecutionModelSql(), args.model));
		}
		if (args.modelId !== undefined) {
			conditions.push(eq(liteLLM_SpendLogs.model_id, args.modelId));
		}
		if (args.endUser !== undefined) {
			conditions.push(eq(liteLLM_SpendLogs.end_user, args.endUser));
		}
		if (args.sessionId !== undefined) {
			const exactKeys = this._exactSessionGroupKeys(args.sessionId);
			if (exactKeys !== null) {
				// 会话详情传入完整 UUID 时直接命中规范键，走 (session_group_key, startTime, request_id)
				// 索引；原来的 %contains% 谓词无法使用该索引，All Time 下要扫完整张表。
				conditions.push(inArray(liteLLM_SpendLogs.session_group_key, exactKeys));
			} else {
				const needle = args.sessionId.toLowerCase();
				conditions.push(
					sql`(${liteLLM_SpendLogs.session_group_key} LIKE ${"s:%"} OR ${liteLLM_SpendLogs.session_group_key} LIKE ${"c:%"}) AND strpos(lower(${liteLLM_SpendLogs.session_group_key}), ${needle}) > 0`,
				);
			}
		}
		if (args.statusFilter !== undefined) {
			if (args.statusFilter === "success") {
				conditions.push(sql`(${liteLLM_SpendLogs.status} = 'success' OR ${liteLLM_SpendLogs.status} IS NULL)`);
			} else {
				conditions.push(sql`${spendLogStatusSql(liteLLM_SpendLogs.status, liteLLM_SpendLogs.metadata)} = ${args.statusFilter}`);
			}
		}
		if (args.minSpend !== undefined) {
			conditions.push(sql`${liteLLM_SpendLogs.spend} >= ${args.minSpend}`);
		}
		if (args.maxSpend !== undefined) {
			conditions.push(sql`${liteLLM_SpendLogs.spend} <= ${args.maxSpend}`);
		}
		if (args.keyAlias !== undefined) {
			// 与 Python `ui_view_spend_logs` 一致保留 LIKE 包含匹配，但改为读冗余列。
			conditions.push(sql`${liteLLM_SpendLogs.key_alias} LIKE ${"%" + args.keyAlias + "%"}`);
		}
		if (args.errorCode !== undefined) {
			conditions.push(eq(liteLLM_SpendLogs.error_code, args.errorCode));
		}
		if (args.errorMessage !== undefined) {
			conditions.push(sql`${spendLogMetadataJsonSql()}->'error_information'->>'error_message' LIKE ${"%" + args.errorMessage + "%"}`);
		}
		return and(...conditions);
	}

	/**
	 * ActiveRequests 对齐 Logs 列表过滤；错误过滤必然排除尚无最终错误信息的请求。
	 * @param args - 过滤参数
	 * @returns 组合后的 where 条件
	 */
	activeRequestsWhereClause(args: UiSpendLogsWhereArgs): SQL {
		const conditions: SQL[] = [gt(liteLLM_ActiveRequests.expires_at, new Date()), eq(liteLLM_ActiveRequests.status, "in_progress")];
		if (args.startDate !== undefined) {
			conditions.push(sql`${liteLLM_ActiveRequests.startTime} >= ${args.startDate}`);
		}
		if (args.endDate !== undefined) {
			conditions.push(sql`${liteLLM_ActiveRequests.startTime} <= ${args.endDate}`);
		}
		if (args.teamId !== undefined) {
			conditions.push(eq(liteLLM_ActiveRequests.team_id, args.teamId));
		}
		if (args.apiKey !== undefined) {
			conditions.push(eq(liteLLM_ActiveRequests.api_key, args.apiKey));
		}
		if (args.user !== undefined) {
			conditions.push(eq(liteLLM_ActiveRequests.user, args.user));
		}
		if (args.requestId !== undefined) {
			conditions.push(eq(liteLLM_ActiveRequests.request_id, args.requestId));
		}
		if (args.model !== undefined) {
			conditions.push(eq(liteLLM_ActiveRequests.model, args.model));
		}
		if (args.modelId !== undefined) {
			conditions.push(eq(liteLLM_ActiveRequests.model_id, args.modelId));
		}
		if (args.endUser !== undefined) {
			conditions.push(eq(liteLLM_ActiveRequests.end_user, args.endUser));
		}
		if (args.sessionId !== undefined) {
			const needle = args.sessionId.toLowerCase();
			const activeSessionKey = sql`litellm_session_group_key(${liteLLM_ActiveRequests.metadata}, ${liteLLM_ActiveRequests.session_id}, ${liteLLM_ActiveRequests.request_id})`;
			conditions.push(
				sql`(${activeSessionKey} LIKE ${"s:%"} OR ${activeSessionKey} LIKE ${"c:%"}) AND strpos(lower(${activeSessionKey}), ${needle}) > 0`,
			);
		}
		if (args.statusFilter !== undefined && args.statusFilter !== "in_progress") {
			conditions.push(sql`FALSE`);
		}
		if (args.minSpend !== undefined && args.minSpend > 0) {
			conditions.push(sql`FALSE`);
		}
		if (args.maxSpend !== undefined && args.maxSpend < 0) {
			conditions.push(sql`FALSE`);
		}
		if (args.keyAlias !== undefined) {
			conditions.push(sql`${liteLLM_ActiveRequests.metadata}->>'user_api_key_alias' LIKE ${"%" + args.keyAlias + "%"}`);
		}
		if (args.errorCode !== undefined || args.errorMessage !== undefined) {
			conditions.push(sql`FALSE`);
		}
		return and(...conditions) as SQL;
	}

	/**
	 * 完整会话 UUID 对应的规范会话键；输入不是可识别 UUID 时返回 null。
	 *
	 * `s:` 是当前写入的规范键；`c:` 兼容历史上按会话 UUID 落库的分组键。
	 * 只有完整 UUID 才走这条精确路径，部分 ID 搜索仍保留原有包含语义。
	 * @param sessionId - 用户传入的会话 ID
	 * @returns 两个候选规范键，或 null
	 */
	private _exactSessionGroupKeys(sessionId: string): [string, string] | null {
		const uuid = normalizeSessionUuid(sessionId);
		return uuid === null ? null : [`s:${uuid}`, `c:${uuid}`];
	}

	// ────────────────────────── 列表与分页 ──────────────────────────

	/**
	 * 统计已落库日志行数。
	 * @param whereClause - 过滤条件；缺省表示全表
	 * @returns 行数
	 */
	async countSpendLogs(whereClause?: SQL): Promise<number> {
		const query = this._db.select({ count: sql<number>`COUNT(*)` }).from(liteLLM_SpendLogs);
		const rows = whereClause === undefined ? await query : await query.where(whereClause);
		return Number(rows.at(0)?.count ?? 0);
	}

	/**
	 * 统计进行中请求行数。
	 * @param whereClause - 过滤条件
	 * @returns 行数
	 */
	async countActiveRequests(whereClause?: SQL): Promise<number> {
		const query = this._db.select({ count: sql<number>`COUNT(*)` }).from(liteLLM_ActiveRequests);
		const rows = whereClause === undefined ? await query : await query.where(whereClause);
		return Number(rows.at(0)?.count ?? 0);
	}

	/**
	 * 旧 `/spend/logs` 分页：按 startTime 倒序取一页。
	 *
	 * `includeContent` 为真时返回整行（正文页），否则只返回轻量列表投影；正文页的结构化块
	 * 由调用方自行 hydrate，所以这里只负责取原始行。
	 * @param options - 过滤、分页与投影开关
	 * @returns 当前页原始行
	 */
	async listLegacySpendLogsPage(options: {
		readonly apiKey?: string;
		readonly userId?: string;
		readonly includeContent: boolean;
		readonly pageSize: number;
		readonly offset: number;
	}): Promise<Array<Record<string, unknown>>> {
		const conditions: SQL[] = [];
		if (options.apiKey) {
			conditions.push(eq(liteLLM_SpendLogs.api_key, options.apiKey));
		}
		if (options.userId) {
			conditions.push(eq(liteLLM_SpendLogs.user, options.userId));
		}
		const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
		const base = options.includeContent
			? this._db.select().from(liteLLM_SpendLogs)
			: this._db.select(this._uiSpendLogSelection()).from(liteLLM_SpendLogs);
		const scoped = whereClause === undefined ? base : base.where(whereClause);
		return (await scoped
			.orderBy(sql`${liteLLM_SpendLogs.startTime} DESC`)
			.limit(options.pageSize)
			.offset(options.offset)) as unknown as Array<Record<string, unknown>>;
	}

	/**
	 * 旧 `/spend/logs` 的总行数。
	 * @param options - 过滤条件
	 * @returns 总行数
	 */
	async countLegacySpendLogs(options: { readonly apiKey?: string; readonly userId?: string }): Promise<number> {
		const conditions: SQL[] = [];
		if (options.apiKey) {
			conditions.push(eq(liteLLM_SpendLogs.api_key, options.apiKey));
		}
		if (options.userId) {
			conditions.push(eq(liteLLM_SpendLogs.user, options.userId));
		}
		const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
		const base = this._db.select({ count: sql<number>`COUNT(*)` }).from(liteLLM_SpendLogs);
		const rows = whereClause === undefined ? await base : await base.where(whereClause);
		return Number(rows.at(0)?.count ?? 0);
	}

	/**
	 * 取当前页的行键：两张表各自按 (startTime, request_id) 取前 N 行，再在内存里归并分页。
	 *
	 * 列表投影会剥掉 metadata 里的流式 checkpoint 载荷，而 `jsonb - 键` 要求 detoast 并
	 * 重建整份 JSON。这个表达式一旦留在 UNION/ORDER BY 里，PostgreSQL 就必须对时间窗内的
	 * 每一行计算一次：24 小时窗口约 1.6 万行时实测多花 40 秒以上，窗口越大越慢，首页也随之
	 * 不可用。改成先分页再回表（见 `hydrateUiPageRows`），重表达式只作用于当前页。
	 *
	 * 分页键仍然单独归并而不是交给 `UNION ALL ... ORDER BY ... LIMIT`：两表各取
	 * (offset + limit) 行即可提前终止，代价只与页深有关；UNION 则要把整个时间窗的索引项和
	 * 堆页都读一遍（24 小时约 1.6 万行，冷缓存下数秒级），并随窗口线性变慢。
	 * @param activeWhereClause - 进行中请求的过滤条件
	 * @param spendLogsWhereClause - 已落库日志的过滤条件
	 * @param sortDirection - 与接口一致的正/倒序
	 * @param pageSize - 每页行数
	 * @param pageOffset - 分页偏移
	 * @returns 当前页的行键（已归并、已去重）
	 */
	async selectMixedUiPageRowKeys(
		activeWhereClause: SQL,
		spendLogsWhereClause: SQL,
		sortDirection: SpendSortDirection,
		pageSize: number,
		pageOffset: number,
	): Promise<UiPageRowKey[]> {
		const needed = pageOffset + pageSize;
		// 两路键合并后要按 request_id 去重，多取一页才能保证去重后仍填满当前页。
		const fetchLimit = needed + pageSize;
		const descending = sortDirection !== "asc";
		const direction = (column: AnyColumn): SQL => (descending ? sql`${column} DESC` : sql`${column} ASC`);
		// 两路键必须在同一快照里读：结算事务是「删在途行 + 插 SpendLog」一次提交，若它正好
		// 落在两条 SELECT 之间，同一个 request_id 会同时出现在两路里，归并后成为相邻的两行。
		// REPEATABLE READ 只在这里包住两条键查询，代价是每个列表请求多一次 BEGIN/COMMIT。
		const { activeKeys, spendKeys } = await this._db.transaction(
			async (tx) => {
				const snapshot = tx as unknown as DrizzleDb;
				const activeKeys = await snapshot
					.select({ request_id: liteLLM_ActiveRequests.request_id, startTime: liteLLM_ActiveRequests.startTime })
					.from(liteLLM_ActiveRequests)
					.where(activeWhereClause)
					.orderBy(direction(liteLLM_ActiveRequests.startTime), direction(liteLLM_ActiveRequests.request_id))
					.limit(fetchLimit);
				const spendKeys = await snapshot
					.select({ request_id: liteLLM_SpendLogs.request_id, startTime: liteLLM_SpendLogs.startTime })
					.from(liteLLM_SpendLogs)
					.where(spendLogsWhereClause)
					.orderBy(direction(liteLLM_SpendLogs.startTime), direction(liteLLM_SpendLogs.request_id))
					.limit(fetchLimit);
				return { activeKeys: activeKeys, spendKeys: spendKeys };
			},
			{ isolationLevel: "repeatable read", accessMode: "read only" },
		);
		const merged = this._mergePageRowKeys(
			activeKeys.map((key) => ({ request_id: key.request_id, startTime: key.startTime, source: "active" as const })),
			spendKeys.map((key) => ({ request_id: key.request_id, startTime: key.startTime, source: "spend" as const })),
			descending,
		);
		return merged.slice(pageOffset, needed).map((key) => ({ request_id: key.request_id, source: key.source }));
	}

	/**
	 * 非 startTime 排序时，进行中请求固定置顶：取出该段的请求 ID。
	 * @param activeWhereClause - 进行中请求的过滤条件
	 * @param sortDirection - 接口的排序方向（用于同 startTime 的稳定兜底）
	 * @param limit - 本页剩余行数
	 * @param offset - 该段内的偏移
	 * @returns 当前页的进行中行键
	 */
	async listActivePageRequestKeys(
		activeWhereClause: SQL,
		sortDirection: SpendSortDirection,
		limit: number,
		offset: number,
	): Promise<UiPageRowKey[]> {
		const rows = await this._db
			.select({ request_id: liteLLM_ActiveRequests.request_id })
			.from(liteLLM_ActiveRequests)
			.where(activeWhereClause)
			// request_id 兜底排序：同一 startTime 的行在两次查询之间可能换位，
			// 偏移分页于是重复或跳到上一页已经出现过的行。
			.orderBy(sql`${liteLLM_ActiveRequests.startTime} DESC`, this._directionOf(liteLLM_ActiveRequests.request_id, sortDirection))
			.limit(limit)
			.offset(offset);
		return rows.map((row) => ({ request_id: row.request_id, source: "active" as const }));
	}

	/**
	 * 非 startTime 排序时取出已完成请求该段的请求 ID。
	 * @param spendLogsWhereClause - 已落库日志的过滤条件
	 * @param sortBy - 排序列
	 * @param sortDirection - 排序方向
	 * @param limit - 本页剩余行数
	 * @param offset - 该段内的偏移
	 * @returns 当前页的已落库行键
	 */
	async listSpendPageRequestKeys(
		spendLogsWhereClause: SQL,
		sortBy: SpendLogSortField,
		sortDirection: SpendSortDirection,
		limit: number,
		offset: number,
	): Promise<UiPageRowKey[]> {
		const orderExpr =
			sortDirection === "asc" ? sql`${this._resolveSortColumn(sortBy)} ASC` : sql`${this._resolveSortColumn(sortBy)} DESC`;
		const rows = await this._db
			.select({ request_id: liteLLM_SpendLogs.request_id })
			.from(liteLLM_SpendLogs)
			.where(spendLogsWhereClause)
			// 所选排序字段大量并列（如 spend/tokens 相同），只有加 request_id
			// 兜底才是全序；否则翻页会把同一行返回两次。
			.orderBy(orderExpr, this._directionOf(liteLLM_SpendLogs.request_id, sortDirection))
			.limit(limit)
			.offset(offset);
		return rows.map((row) => ({ request_id: row.request_id, source: "spend" as const }));
	}

	/**
	 * 按主键回表读取当前页的列表投影。
	 *
	 * 调用方先分页再回表，因此 metadata 剥载荷、失败调用的模型回退和状态兼容这些重表达式
	 * 只对每页几十行各计算一次，与时间窗大小、日志总量无关。分页键与回表之间可能正好有
	 * 请求落库或租约回收，来源表查不到时再用另一张表的同一行兜底，避免页面上少一行。
	 * @param keys - 已排好序的分页键
	 * @returns 当前页的行（未规范化）
	 */
	async hydrateUiPageRows(keys: readonly UiPageRowKey[]): Promise<Array<Record<string, unknown>>> {
		if (keys.length === 0) {
			return [];
		}
		const bySource = new Map<string, Record<string, unknown>>();
		const spendIds = uniqueRequestIds(keys.filter((key) => key.source === "spend"));
		const activeIds = uniqueRequestIds(keys.filter((key) => key.source === "active"));
		if (spendIds.length > 0) {
			const rows = await this._db
				.select(this._uiSpendLogSelection())
				.from(liteLLM_SpendLogs)
				.where(inArray(liteLLM_SpendLogs.request_id, spendIds));
			for (const row of rows) {
				bySource.set(`spend:${String((row as Record<string, unknown>).request_id)}`, row as Record<string, unknown>);
			}
		}
		if (activeIds.length > 0) {
			const rows = await this._db
				.select(this._uiActiveRequestSelection())
				.from(liteLLM_ActiveRequests)
				.where(inArray(liteLLM_ActiveRequests.request_id, activeIds));
			for (const row of rows) {
				bySource.set(`active:${String((row as Record<string, unknown>).request_id)}`, row as Record<string, unknown>);
			}
		}
		// 分页键与回表之间跨越了提交边界：进行中行已落库，或已落库行被租约回收。
		const migratedToSpend = missingRequestIds(keys, bySource, "active");
		if (migratedToSpend.length > 0) {
			const rows = await this._db
				.select(this._uiSpendLogSelection())
				.from(liteLLM_SpendLogs)
				.where(inArray(liteLLM_SpendLogs.request_id, migratedToSpend));
			for (const row of rows) {
				bySource.set(`fallback:${String((row as Record<string, unknown>).request_id)}`, row as Record<string, unknown>);
			}
		}
		const migratedToActive = missingRequestIds(keys, bySource, "spend");
		if (migratedToActive.length > 0) {
			const rows = await this._db
				.select(this._uiActiveRequestSelection())
				.from(liteLLM_ActiveRequests)
				.where(inArray(liteLLM_ActiveRequests.request_id, migratedToActive));
			for (const row of rows) {
				bySource.set(`fallback:${String((row as Record<string, unknown>).request_id)}`, row as Record<string, unknown>);
			}
		}
		return keys.flatMap((key) => {
			const row = bySource.get(`${key.source}:${key.request_id}`) ?? bySource.get(`fallback:${key.request_id}`);
			return row === undefined ? [] : [row];
		});
	}

	/**
	 * 已落库日志按会话分组计数（Session 列表的 `session_total_count`）。
	 * @param groupKeys - 规范会话键
	 * @param visibilityClause - 已鉴权的可见性条件
	 * @returns 每个会话键的已落库行数
	 */
	async countSpendLogsBySessionGroup(
		groupKeys: readonly string[],
		visibilityClause: SQL,
	): Promise<Array<{ readonly session_group_key: string; readonly total: number }>> {
		return (await this._db
			.select({
				session_group_key: liteLLM_SpendLogs.session_group_key,
				total: sql<number>`COUNT(*)`,
			})
			.from(liteLLM_SpendLogs)
			.where(and(inArray(liteLLM_SpendLogs.session_group_key, [...groupKeys]), visibilityClause))
			.groupBy(liteLLM_SpendLogs.session_group_key)) as unknown as Array<{
			readonly session_group_key: string;
			readonly total: number;
		}>;
	}

	/**
	 * 会话详情分页读取：按 (startTime, request_id) 升序取一段。
	 *
	 * 会话模拟用 keyset 游标翻页，`offset` 只服务旧的 page 入参；为 0 时不下发 OFFSET，
	 * 保持与纯游标查询一致的执行计划。
	 * @param options - 过滤、投影与分页参数
	 * @returns 当前页原始行
	 */
	async listSessionDetailRows(options: {
		readonly whereClause: SQL;
		readonly includeContent: boolean;
		readonly limit: number;
		readonly offset?: number;
	}): Promise<Array<Record<string, unknown>>> {
		const selection = options.includeContent ? this._uiSpendLogSelectionWithContent() : this._uiSpendLogSelection();
		const query = this._db
			.select(selection)
			.from(liteLLM_SpendLogs)
			.where(options.whereClause)
			.orderBy(asc(liteLLM_SpendLogs.startTime), asc(liteLLM_SpendLogs.request_id))
			.limit(options.limit);
		const rows = options.offset !== undefined && options.offset > 0 ? await query.offset(options.offset) : await query;
		return rows as unknown as Array<Record<string, unknown>>;
	}

	/**
	 * 会话快照锚点：当前最新的 (startTime, request_id)。
	 *
	 * 必须取同一行的两个字段（`ORDER BY ... LIMIT 1`），不能分别取 MAX：分成两个聚合会把
	 * 不同行的 startTime 与 request_id 拼成一个不存在的锚点，分页边界随之错位。
	 * @param whereClause - 会话分组条件（已含可见性）
	 * @returns 锚点行，或 undefined
	 */
	async findSessionSnapshotPosition(
		whereClause: SQL,
	): Promise<{ readonly snapshotStartTime: Date; readonly snapshotRequestId: string } | undefined> {
		const rows = await this._db
			.select({ snapshotStartTime: liteLLM_SpendLogs.startTime, snapshotRequestId: liteLLM_SpendLogs.request_id })
			.from(liteLLM_SpendLogs)
			.where(whereClause)
			.orderBy(sql`${liteLLM_SpendLogs.startTime} DESC, ${liteLLM_SpendLogs.request_id} DESC`)
			.limit(1);
		return rows.at(0);
	}

	// ────────────────────────── 单条与批量详情 ──────────────────────────

	/**
	 * 批量取日志正文列（Session 批量补缺用）。
	 * @param requestIds - 需要正文的请求 ID
	 * @returns 每行的 messages / response / proxy_server_request
	 */
	async listSpendLogPayloadColumns(requestIds: readonly string[]): Promise<
		Array<{
			readonly request_id: string;
			readonly messages: unknown;
			readonly response: unknown;
			readonly proxy_server_request: unknown;
		}>
	> {
		return (await this._db
			.select({
				request_id: liteLLM_SpendLogs.request_id,
				messages: liteLLM_SpendLogs.messages,
				response: liteLLM_SpendLogs.response,
				proxy_server_request: liteLLM_SpendLogs.proxy_server_request,
			})
			.from(liteLLM_SpendLogs)
			.where(inArray(liteLLM_SpendLogs.request_id, [...requestIds]))) as unknown as Array<{
			readonly request_id: string;
			readonly messages: unknown;
			readonly response: unknown;
			readonly proxy_server_request: unknown;
		}>;
	}

	/**
	 * 单条日志的正文列（冷存储未命中时回表）。
	 * @param requestId - 请求 ID
	 * @returns 正文列，或 undefined
	 */
	async findSpendLogDetailColumns(
		requestId: string,
	): Promise<{ readonly messages: unknown; readonly response: unknown; readonly proxy_server_request: unknown } | undefined> {
		const rows = await this._db
			.select({
				messages: liteLLM_SpendLogs.messages,
				response: liteLLM_SpendLogs.response,
				proxy_server_request: liteLLM_SpendLogs.proxy_server_request,
			})
			.from(liteLLM_SpendLogs)
			.where(eq(liteLLM_SpendLogs.request_id, requestId))
			.limit(1);
		return rows.at(0);
	}

	/**
	 * 进行中请求的轻量修订号：日志流据此判断「这次轮询是否有新东西」。
	 * @param requestId - 请求 ID
	 * @returns `status` 与 `updated_at`，或 undefined
	 */
	async findActiveRequestRevision(
		requestId: string,
	): Promise<{ readonly status: string | null; readonly updated_at: Date | string | null } | undefined> {
		const rows = await this._db
			.select({
				status: liteLLM_ActiveRequests.status,
				updated_at: liteLLM_ActiveRequests.updated_at,
			})
			.from(liteLLM_ActiveRequests)
			.where(eq(liteLLM_ActiveRequests.request_id, requestId))
			.limit(1);
		return rows.at(0);
	}

	/**
	 * 进行中请求的详情投影。
	 *
	 * 返回在途行里已经补写确定的字段（provider/api_base/model_id/上游交换/TTFT/已观测
	 * token），使详情页不必等最终 SpendLog 才显示路由与用量。
	 * @param requestId - 请求 ID
	 * @returns 详情行，或 undefined
	 */
	async findActiveRequestDetailRow(requestId: string): Promise<Record<string, unknown> | undefined> {
		const rows = await this._db
			.select({
				request_id: liteLLM_ActiveRequests.request_id,
				call_type: liteLLM_ActiveRequests.call_type,
				startTime: liteLLM_ActiveRequests.startTime,
				model: liteLLM_ActiveRequests.model,
				model_id: liteLLM_ActiveRequests.model_id,
				model_group: liteLLM_ActiveRequests.model_group,
				custom_llm_provider: liteLLM_ActiveRequests.custom_llm_provider,
				api_base: liteLLM_ActiveRequests.api_base,
				user: liteLLM_ActiveRequests.user,
				team_id: liteLLM_ActiveRequests.team_id,
				organization_id: liteLLM_ActiveRequests.organization_id,
				end_user: liteLLM_ActiveRequests.end_user,
				requester_ip_address: liteLLM_ActiveRequests.requester_ip_address,
				session_id: liteLLM_ActiveRequests.session_id,
				request_tags: liteLLM_ActiveRequests.request_tags,
				completion_start_time: liteLLM_ActiveRequests.completion_start_time,
				proxy_server_request: liteLLM_ActiveRequests.proxy_server_request,
				metadata: liteLLM_ActiveRequests.metadata,
				request_duration_ms: sql<number>`GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ${liteLLM_ActiveRequests.startTime})) * 1000))::int`,
			})
			.from(liteLLM_ActiveRequests)
			.where(eq(liteLLM_ActiveRequests.request_id, requestId))
			.limit(1);
		return rows.at(0) as unknown as Record<string, unknown> | undefined;
	}

	// ────────────────────────── 聚合报表 ──────────────────────────

	/**
	 * 按密钥聚合费用（`/spend/keys`）。
	 * @param limit - 行数上限
	 * @returns 每个密钥的合计
	 */
	async sumSpendByApiKey(
		limit: number,
	): Promise<Array<{ readonly api_key: unknown; readonly total_spend: unknown; readonly total_tokens: unknown }>> {
		return this._db
			.select({
				api_key: liteLLM_SpendLogs.api_key,
				total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
				total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
			})
			.from(liteLLM_SpendLogs)
			.groupBy(liteLLM_SpendLogs.api_key)
			.limit(limit);
	}

	/**
	 * 按用户聚合费用（`/spend/users`）。
	 * @param limit - 行数上限
	 * @returns 每个用户的合计
	 */
	async sumSpendByUser(
		limit: number,
	): Promise<Array<{ readonly user: unknown; readonly total_spend: unknown; readonly total_tokens: unknown }>> {
		return this._db
			.select({
				user: liteLLM_SpendLogs.user,
				total_spend: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.spend}), 0)`,
				total_tokens: sql<number>`COALESCE(SUM(${liteLLM_SpendLogs.total_tokens}), 0)`,
			})
			.from(liteLLM_SpendLogs)
			.where(sql`${liteLLM_SpendLogs.user} IS NOT NULL AND ${liteLLM_SpendLogs.user} != ''`)
			.groupBy(liteLLM_SpendLogs.user)
			.limit(limit);
	}

	/**
	 * 把 request_tags 数组炸开按 tag 聚合（`/spend/tags`）。
	 *
	 * Python 忽略 start_date/end_date 查询参数（SQL 无日期过滤），这里保持同一行为。
	 * @returns 每个 tag 元素的行数与费用
	 */
	async sumSpendByRequestTagElement(): Promise<
		Array<{ readonly individual_request_tag: unknown; readonly log_count: unknown; readonly total_spend: unknown }>
	> {
		return this._db
			.select({
				individual_request_tag: sql<string>`jsonb_array_elements_text(${liteLLM_SpendLogs.request_tags})`.as(
					"individual_request_tag",
				),
				log_count: sql<number>`COUNT(*)`,
				total_spend: sql<number>`SUM(${liteLLM_SpendLogs.spend})`,
			})
			.from(liteLLM_SpendLogs)
			.groupBy(sql`individual_request_tag`);
	}

	// ────────────────────────── 内部投影 ──────────────────────────

	/**
	 * `/spend/logs/ui` 的轻量列表投影（不含 messages / response / proxy_server_request）。
	 * @returns Drizzle 投影对象
	 */
	private _uiSpendLogSelection() {
		return {
			request_id: liteLLM_SpendLogs.request_id,
			call_type: liteLLM_SpendLogs.call_type,
			api_key: liteLLM_SpendLogs.api_key,
			key_alias: liteLLM_SpendLogs.key_alias,
			spend: liteLLM_SpendLogs.spend,
			total_tokens: liteLLM_SpendLogs.total_tokens,
			prompt_tokens: liteLLM_SpendLogs.prompt_tokens,
			completion_tokens: liteLLM_SpendLogs.completion_tokens,
			// 这两个投影列已经由 0019 回填；列表直接读列，避免每行再解压
			// metadata.additional_usage_values / usage_object。
			cache_read_input_tokens: liteLLM_SpendLogs.cache_read_input_tokens,
			cache_creation_input_tokens: liteLLM_SpendLogs.cache_creation_input_tokens,
			// 单价与峰谷档位是请求结束时冻结的账单事实（见 drizzle/0023）；列表直接读列，
			// 费用气泡与详情不必为每行 detoast metadata.cost_breakdown。
			unit_prices: liteLLM_SpendLogs.unit_prices,
			peak_tier: liteLLM_SpendLogs.peak_tier,
			startTime: liteLLM_SpendLogs.startTime,
			endTime: liteLLM_SpendLogs.endTime,
			completionStartTime: liteLLM_SpendLogs.completionStartTime,
			model: spendLogExecutionModelSql(),
			model_id: liteLLM_SpendLogs.model_id,
			model_group: liteLLM_SpendLogs.model_group,
			custom_llm_provider: sql<string | null>`${liteLLM_SpendLogs.custom_llm_provider}`,
			api_base: sql<string | null>`${liteLLM_SpendLogs.api_base}`,
			user: liteLLM_SpendLogs.user,
			// 列表不下发流式 checkpoint 累计正文：回收行会把整份累计响应塞进 metadata，
			// 单行可达数兆，既撑大每页响应也让客户端多解析几十毫秒。
			metadata: spendLogListMetadataSql(),
			cache_hit: sql<string | null>`${liteLLM_SpendLogs.cache_hit}`,
			cache_key: liteLLM_SpendLogs.cache_key,
			request_tags: sql<unknown | null>`${liteLLM_SpendLogs.request_tags}`,
			team_id: liteLLM_SpendLogs.team_id,
			organization_id: liteLLM_SpendLogs.organization_id,
			end_user: liteLLM_SpendLogs.end_user,
			requester_ip_address: liteLLM_SpendLogs.requester_ip_address,
			session_id: liteLLM_SpendLogs.session_id,
			session_group_key: liteLLM_SpendLogs.session_group_key,
			status: spendLogStatusSql(liteLLM_SpendLogs.status, liteLLM_SpendLogs.metadata),
			mcp_namespaced_tool_name: liteLLM_SpendLogs.mcp_namespaced_tool_name,
			agent_id: liteLLM_SpendLogs.agent_id,
			request_duration_ms: spendLogDurationSql(),
			// 非流式请求没有「首帧」这个时刻，前端据此把 TTFT 显示成 `-`（见 streamRequestedSql）。
			stream: streamRequestedSql(liteLLM_SpendLogs.proxy_server_request),
		};
	}

	/**
	 * Session 模拟专用投影，在轻量行上按需附带会话正文。
	 * @returns Drizzle 投影对象
	 */
	private _uiSpendLogSelectionWithContent() {
		return {
			...this._uiSpendLogSelection(),
			messages: liteLLM_SpendLogs.messages,
			response: liteLLM_SpendLogs.response,
			proxy_server_request: liteLLM_SpendLogs.proxy_server_request,
		};
	}

	/**
	 * 活跃请求转成与 UI SpendLog 列表兼容的轻量行。
	 *
	 * 列名与已落库投影一一对应：前端用同一套渲染逻辑，缺失的账单事实（spend / 单价 /
	 * 会话键）以 NULL 或 0 占位，结算后由 SpendLogs 行替换。
	 * @returns Drizzle 投影对象
	 */
	private _uiActiveRequestSelection() {
		return {
			request_id: liteLLM_ActiveRequests.request_id,
			call_type: liteLLM_ActiveRequests.call_type,
			api_key: liteLLM_ActiveRequests.api_key,
			spend: sql<number>`0`,
			total_tokens: sql<number>`0`,
			prompt_tokens: sql<number>`0`,
			completion_tokens: sql<number>`0`,
			startTime: liteLLM_ActiveRequests.startTime,
			endTime: sql<Date>`CURRENT_TIMESTAMP`,
			completionStartTime: liteLLM_ActiveRequests.completion_start_time,
			model: liteLLM_ActiveRequests.model,
			model_id: liteLLM_ActiveRequests.model_id,
			model_group: liteLLM_ActiveRequests.model_group,
			// ActiveRequests 侧非空，UNION 需要与 SpendLogs 侧的可空类型对齐。
			custom_llm_provider: sql<string | null>`${liteLLM_ActiveRequests.custom_llm_provider}`,
			api_base: sql<string | null>`${liteLLM_ActiveRequests.api_base}`,
			user: liteLLM_ActiveRequests.user,
			// 聚合中的响应正文只属于详情页，列表不重复下发（见 /spend/logs/ui/:request_id）。
			metadata: sql<
				unknown | null
			>`COALESCE(${liteLLM_ActiveRequests.metadata}, '{}'::jsonb) - 'streaming_execution' - 'responses_execution'`,
			cache_hit: sql<string | null>`'False'`,
			cache_key: sql<string | null>`NULL`,
			// 进行中的请求尚未结算，没有可冻结的单价与档位。
			unit_prices: sql<unknown | null>`NULL`,
			peak_tier: sql<string | null>`NULL`,
			request_tags: sql<unknown | null>`${liteLLM_ActiveRequests.request_tags}`,
			team_id: liteLLM_ActiveRequests.team_id,
			organization_id: liteLLM_ActiveRequests.organization_id,
			end_user: liteLLM_ActiveRequests.end_user,
			requester_ip_address: liteLLM_ActiveRequests.requester_ip_address,
			session_id: liteLLM_ActiveRequests.session_id,
			session_group_key: sql<string | null>`NULL`,
			status: sql<string | null>`${liteLLM_ActiveRequests.status}`,
			mcp_namespaced_tool_name: sql<string | null>`NULL`,
			agent_id: sql<string | null>`NULL`,
			request_duration_ms: sql<number>`GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ${liteLLM_ActiveRequests.startTime})) * 1000))::int`,
			// 与 SpendLogs 侧同一表达式，进行中的非流式请求同样没有首帧时间。
			stream: streamRequestedSql(liteLLM_ActiveRequests.proxy_server_request),
		};
	}

	/**
	 * 把排序列白名单解析成 Drizzle 列。
	 * @param sortBy - 排序列名
	 * @returns 对应的列或表达式
	 */
	private _resolveSortColumn(sortBy: SpendLogSortField): AnyColumn | SQL {
		switch (sortBy) {
			case "spend":
				return liteLLM_SpendLogs.spend;
			case "total_tokens":
				return liteLLM_SpendLogs.total_tokens;
			case "endTime":
				return liteLLM_SpendLogs.endTime;
			case "request_duration_ms":
				return spendLogDurationSql();
			case "startTime":
			default:
				return liteLLM_SpendLogs.startTime;
		}
	}

	/**
	 * 排序列的兜底次序：与主排序同向，保证「主列并列」时仍是全序。
	 * @param column - 兜底列
	 * @param sortDirection - 接口的排序方向
	 * @returns asc / desc 表达式
	 */
	private _directionOf(column: AnyColumn, sortDirection: SpendSortDirection): SQL {
		return sortDirection === "asc" ? asc(column) : sql`${column} DESC`;
	}

	/**
	 * 归并两路已按 (startTime, request_id) 排好序的分页键，保持全局顺序与分页边界稳定。
	 * @param left - 进行中请求的分页键
	 * @param right - 已落库日志的分页键
	 * @param descending - 是否与接口倒序一致
	 * @returns 归并并去重后的分页键
	 */
	private _mergePageRowKeys(left: UiPageRowKeyWithTime[], right: UiPageRowKeyWithTime[], descending: boolean): UiPageRowKeyWithTime[] {
		const direction = descending ? -1 : 1;
		const merged: UiPageRowKeyWithTime[] = [];
		let leftIndex = 0;
		let rightIndex = 0;
		while (leftIndex < left.length && rightIndex < right.length) {
			const leftKey = left.at(leftIndex);
			const rightKey = right.at(rightIndex);
			if (leftKey === undefined || rightKey === undefined) {
				break;
			}
			if (comparePageRowKeys(leftKey, rightKey) * direction <= 0) {
				merged.push(leftKey);
				leftIndex += 1;
			} else {
				merged.push(rightKey);
				rightIndex += 1;
			}
		}
		return this._dedupePageRowKeys(merged.concat(left.slice(leftIndex), right.slice(rightIndex)));
	}

	/**
	 * 同一个 request_id 在归并后的分页键里只能占一个位置。
	 *
	 * 正常路径下两路键在同一个 `REPEATABLE READ` 事务里读取，同一次结算不会同时出现在
	 * ActiveRequests 与 SpendLogs 两路结果里。这里仍做收敛，兜住事务边界之外的来源：
	 * 历史版本曾把两次键查询分开执行，结算提交落在两次查询之间时同一个 request_id 会
	 * 同时出现在两路里（startTime 相同，归并后相邻），回表时「在途键找不到就回落到
	 * SpendLogs」会把两条键都解析成同一行，列表于是出现两条内容完全一样、request_id
	 * 也相同的日志。去重保留首次出现的位置，来源选已结算（spend）的那一条。
	 * @param keys - 已归并的分页键
	 * @returns 去重后的分页键
	 */
	private _dedupePageRowKeys(keys: UiPageRowKeyWithTime[]): UiPageRowKeyWithTime[] {
		if (keys.length < 2) {
			return keys;
		}
		const byId = new Map<string, number>();
		const result: UiPageRowKeyWithTime[] = [];
		let dropped = 0;
		for (const key of keys) {
			const index = byId.get(key.request_id);
			if (index === undefined) {
				byId.set(key.request_id, result.length);
				result.push(key);
				continue;
			}
			dropped += 1;
			if (result[index]?.source !== "spend" && key.source === "spend") {
				result[index] = key;
			}
		}
		if (dropped > 0) {
			logger.warn("列表分页键命中同一 request_id 的两条来源，已按已结算行收敛", { dropped: dropped });
		}
		return result;
	}
}

/**
 * 分页键里某一来源的 request_id，保持首次出现顺序并去重。
 * @param keys - 分页键
 * @returns 去重后的 request_id
 */
function uniqueRequestIds(keys: readonly UiPageRowKey[]): string[] {
	return Array.from(new Set(keys.map((key) => key.request_id)));
}

/**
 * 找出主投影没有命中的某一来源 request_id。
 * @param keys - 分页键
 * @param bySource - 已回表的结果（按 `来源:request_id` 索引）
 * @param source - 需要检查的来源
 * @returns 需要回另一张表兜底的 request_id
 */
function missingRequestIds(
	keys: readonly UiPageRowKey[],
	bySource: Map<string, Record<string, unknown>>,
	source: UiPageRowKey["source"],
): string[] {
	return uniqueRequestIds(keys.filter((key) => key.source === source && !bySource.has(`${source}:${key.request_id}`)));
}

/**
 * 分页键的升序比较：startTime 优先，同一时刻用 request_id 保持稳定顺序。
 * @param left - 左分页键
 * @param right - 右分页键
 * @returns 负数表示 left 在前
 */
function comparePageRowKeys(left: UiPageRowKeyWithTime, right: UiPageRowKeyWithTime): number {
	const byTime = left.startTime.getTime() - right.startTime.getTime();
	if (byTime !== 0) {
		return byTime;
	}
	return left.request_id < right.request_id ? -1 : left.request_id > right.request_id ? 1 : 0;
}
