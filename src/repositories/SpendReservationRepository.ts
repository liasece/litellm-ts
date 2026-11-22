/**
 * LiteLLM_SpendReservations 仓库 — 费用预留账本的全部读写，以及预留期间对预算主体的加锁读取。
 *
 * 预留是结算链路里唯一会「先占额度、后按实际费用结算」的账本：请求开始时按上界写入
 * `reserved`，结算时改 `settled`/`released`。并发安全依赖 PostgreSQL advisory
 * transaction lock + `FOR UPDATE`，因此所有方法都接收调用方事务句柄，本仓库不自行开启
 * 或提交事务；同一预算主体的余额校验与账本写入因此始终落在同一个事务里。
 *
 * 预算主体分散在 key / user / team / organization / project / team_member / end_user
 * 七张表上，但读取它们的唯一目的是「这笔预留会不会超预算」，属于预留账本的一部分；
 * 这些 SQL 只用于本仓库的余额校验，不构成其他模块的通用读取入口。
 *
 * 账本按请求增长，不做缓存。
 */

import { and, eq, sql } from "drizzle-orm";
import { ApiError } from "../core/api/ApiError";
import { BaseRepository } from "../core/db/BaseRepository";
import type { DrizzleDb } from "../core/db/Database";
import { liteLLM_SpendReservations } from "../db/schema/spendReservations";
import type { SpendReservationScope } from "../types/spend";
import { singletonFor } from "./internal/registry";

/** `LiteLLM_SpendReservations` 行。 */
export type SpendReservationRow = typeof liteLLM_SpendReservations.$inferSelect;

/** 事务句柄；预留与结算都由调用方开启事务。 */
export type SpendReservationTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

/** 可用于预留读写的句柄：普通连接或事务。 */
export type SpendReservationExecutor = DrizzleDb | SpendReservationTransaction;

/** 新建预留行所需的字段。 */
export interface SpendReservationInsert {
	/** 全局幂等键。 */
	readonly requestId: string;
	/** 本次参与预算校验的主体键（已排序去重）。 */
	readonly scopeIds: readonly string[];
	/** 预留金额。 */
	readonly reserved: number;
	/** 租约到期时间。 */
	readonly expiresAt: Date;
}

/** 重新获取过期预留租约所需的字段。 */
export interface SpendReservationResume extends SpendReservationInsert {
	/** 本次续租的当前时间。 */
	readonly now: Date;
}

/** 预算主体当前余额快照。 */
interface ReservationBudget {
	/** 主体自身（或其 budget_id 指向的预算）上限；null 表示无硬上限。 */
	readonly maxBudget: number | null;
	/** 主体已落账的 spend。 */
	readonly spend: number;
}

/**
 * 取得与数据库连接绑定的预留仓库。
 * @param db - Drizzle 数据库实例
 */
export const spendReservationRepositoryFor = singletonFor((db: DrizzleDb) => new SpendReservationRepository(db));

/**
 * 把预算主体编码成账本 `scope_ids` 里的稳定键。
 * @param scope - 预算主体
 * @returns 形如 `key:sk-...` 或 `team_member:[user,team]` 的键
 */
export function reservationScopeKey(scope: SpendReservationScope): string {
	return scope.kind === "team_member" ? `team_member:${JSON.stringify([scope.userId, scope.teamId])}` : `${scope.kind}:${scope.id}`;
}

/**
 * 解析账本里的主体键。
 * @param scopeKey - `reservationScopeKey` 生成的键
 * @returns 预算主体
 * @throws {ApiError} 键损坏时抛 503（账本里有无法解释的数据，不能静默跳过预算）
 */
export function parseReservationScopeKey(scopeKey: string): SpendReservationScope {
	if (scopeKey.startsWith("team_member:")) {
		const pair = JSON.parse(scopeKey.slice("team_member:".length)) as unknown;
		if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string") {
			throw ApiError.unavailable(`预留预算主体损坏: ${scopeKey}`);
		}
		return { kind: "team_member", userId: pair[0], teamId: pair[1] };
	}
	const separator = scopeKey.indexOf(":");
	const kind = scopeKey.slice(0, separator);
	const id = scopeKey.slice(separator + 1);
	if (
		separator <= 0 ||
		!id ||
		!(["key", "user", "team", "organization", "project", "end_user"] as const).includes(
			kind as "key" | "user" | "team" | "organization" | "project" | "end_user",
		)
	) {
		throw ApiError.unavailable(`预留预算主体损坏: ${scopeKey}`);
	}
	return { kind: kind as "key" | "user" | "team" | "organization" | "project" | "end_user", id: id };
}

/** `LiteLLM_SpendReservations` 的 SQL 访问点。 */
export class SpendReservationRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例（BaseRepository 构造为 protected，显式公开子类构造）
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	/**
	 * 按请求 ID 读取预留行。
	 * @param executor - 数据库或事务句柄
	 * @param requestId - 请求 ID
	 * @returns 预留行；不存在时为 undefined
	 */
	async findByRequestId(executor: SpendReservationExecutor, requestId: string): Promise<SpendReservationRow | undefined> {
		const rows = await executor.select().from(liteLLM_SpendReservations).where(eq(liteLLM_SpendReservations.request_id, requestId));
		return rows[0];
	}

	/**
	 * 原子延长仍活跃且未过期的预留租约。
	 * @param executor - 数据库或事务句柄
	 * @param requestId - 请求 ID
	 * @param expiresAt - 新的到期时间
	 * @param now - 续租的当前时间
	 * @returns 续租后的行；租约已失效时为 undefined
	 */
	async renewLease(
		executor: SpendReservationExecutor,
		requestId: string,
		expiresAt: Date,
		now: Date,
	): Promise<SpendReservationRow | undefined> {
		const rows = await executor
			.update(liteLLM_SpendReservations)
			.set({ expires_at: expiresAt, updated_at: now })
			.where(
				and(
					eq(liteLLM_SpendReservations.request_id, requestId),
					eq(liteLLM_SpendReservations.status, "reserved"),
					sql`${liteLLM_SpendReservations.expires_at} > now()`,
				),
			)
			.returning();
		return rows[0];
	}

	/**
	 * 重新获取同 request_id 的过期预留租约。
	 * @param executor - 数据库或事务句柄
	 * @param input - 请求 ID、主体键、预留金额与新租约
	 * @returns 续租后的行；被并发请求抢先时为 undefined
	 */
	async resumeExpired(executor: SpendReservationExecutor, input: SpendReservationResume): Promise<SpendReservationRow | undefined> {
		const rows = await executor
			.update(liteLLM_SpendReservations)
			.set({
				scope_ids: input.scopeIds,
				reserved: input.reserved,
				actual: null,
				status: "reserved",
				expires_at: input.expiresAt,
				updated_at: input.now,
			})
			.where(
				and(
					eq(liteLLM_SpendReservations.request_id, input.requestId),
					eq(liteLLM_SpendReservations.status, "reserved"),
					sql`${liteLLM_SpendReservations.expires_at} <= now()`,
				),
			)
			.returning();
		return rows[0];
	}

	/**
	 * 写入一条新预留；同一 request_id 已存在时不覆盖。
	 * @param executor - 数据库或事务句柄
	 * @param input - 新预留行字段
	 * @returns 插入的行；并发插入冲突时为 undefined
	 */
	async insertReserved(executor: SpendReservationExecutor, input: SpendReservationInsert): Promise<SpendReservationRow | undefined> {
		const inserted = await executor
			.insert(liteLLM_SpendReservations)
			.values({
				request_id: input.requestId,
				scope_ids: input.scopeIds,
				reserved: input.reserved,
				status: "reserved",
				expires_at: input.expiresAt,
			})
			.onConflictDoNothing()
			.returning();
		return inserted[0];
	}

	/**
	 * 幂等释放仍处于 reserved 的预留。
	 * @param executor - 数据库或事务句柄
	 * @param requestId - 请求 ID
	 * @param now - 更新时间
	 * @returns 被本次释放的行；已经是终态时为空数组
	 */
	async markReleased(executor: SpendReservationExecutor, requestId: string, now: Date): Promise<SpendReservationRow[]> {
		return await executor
			.update(liteLLM_SpendReservations)
			.set({ status: "released", updated_at: now })
			.where(and(eq(liteLLM_SpendReservations.request_id, requestId), eq(liteLLM_SpendReservations.status, "reserved")))
			.returning();
	}

	/**
	 * 幂等结算仍处于 reserved 的预留。
	 * @param executor - 数据库或事务句柄
	 * @param requestId - 请求 ID
	 * @param actual - 实际费用
	 * @param now - 更新时间
	 * @returns 被本次结算的行；已经是终态时为空数组
	 */
	async markSettled(executor: SpendReservationExecutor, requestId: string, actual: number, now: Date): Promise<SpendReservationRow[]> {
		return await executor
			.update(liteLLM_SpendReservations)
			.set({ status: "settled", actual: actual, updated_at: now })
			.where(and(eq(liteLLM_SpendReservations.request_id, requestId), eq(liteLLM_SpendReservations.status, "reserved")))
			.returning();
	}

	/**
	 * 落账事务里的预留终结：一次往返拿到主体键，供随后的余额重检使用。
	 *
	 * 只有原本仍是 reserved 的行会被命中；没有预留的请求只付一条空更新的成本。
	 * @param executor - 数据库或事务句柄
	 * @param requestId - 请求 ID
	 * @param status - 终结状态（settled 或 released）
	 * @param actual - 实际费用；released 时写 null
	 * @param now - 更新时间
	 * @returns 被终结行的主体键；没有预留时为 undefined
	 */
	async finishReserved(
		executor: SpendReservationExecutor,
		requestId: string,
		status: "settled" | "released",
		actual: number | null,
		now: Date,
	): Promise<readonly string[] | undefined> {
		const rows = await executor
			.update(liteLLM_SpendReservations)
			.set({ status: status, actual: actual, updated_at: now })
			.where(and(eq(liteLLM_SpendReservations.request_id, requestId), eq(liteLLM_SpendReservations.status, "reserved")))
			.returning({ scopeIds: liteLLM_SpendReservations.scope_ids });
		return rows[0]?.scopeIds;
	}

	/**
	 * 校验预留不会击穿任一主体的预算。
	 *
	 * 对每个主体先取 advisory transaction lock（跨实例串行化同一主体的余额校验），再
	 * `FOR UPDATE` 读取自身余额与 budget_id 指向的预算上限，最后把仍有效的其他预留
	 * 求和。校验在主体 spend 累加之前执行，`SUM` 用 `excludedRequestId` 排除自己。
	 * @param executor - 数据库或事务句柄
	 * @param scopes - 预算主体
	 * @param amount - 本次要占用的金额
	 * @param excludedRequestId - 需要在有效预留总和中排除的请求 ID
	 */
	async assertFits(
		executor: SpendReservationExecutor,
		scopes: readonly SpendReservationScope[],
		amount: number,
		excludedRequestId?: string,
	): Promise<void> {
		const uniqueScopes = new Map(scopes.map((scope) => [reservationScopeKey(scope), scope]));
		for (const [scopeKey, scope] of [...uniqueScopes.entries()].sort(([left], [right]) => left.localeCompare(right))) {
			const budget = await this._lockBudget(executor, scope);
			const active = (await executor.execute(
				excludedRequestId
					? sql`SELECT COALESCE(SUM(reserved), 0) AS reserved FROM "LiteLLM_SpendReservations" WHERE status = 'reserved' AND expires_at > now() AND request_id <> ${excludedRequestId} AND scope_ids @> ${JSON.stringify([scopeKey])}::jsonb`
					: sql`SELECT COALESCE(SUM(reserved), 0) AS reserved FROM "LiteLLM_SpendReservations" WHERE status = 'reserved' AND expires_at > now() AND scope_ids @> ${JSON.stringify([scopeKey])}::jsonb`,
			)) as unknown as { rows: Array<{ reserved: number | string }> };
			const activeReserved = Number(active.rows[0]?.reserved ?? 0);
			if (budget.maxBudget !== null && budget.spend + activeReserved + amount > budget.maxBudget) {
				throw ApiError.tooManyRequests(`预算不足: ${scopeKey}`);
			}
		}
	}

	/**
	 * 在事务内锁定并读取一个可独立计费的预算主体。
	 *
	 * key / user / team 自身带 `max_budget`；organization / project / team_member /
	 * end_user 只有 `budget_id`，上限要再读一次 BudgetTable。主体不存在时抛 503：
	 * 预留对着一个已删除的主体没有意义，静默跳过会放过超支。
	 * @param executor - 数据库或事务句柄
	 * @param scope - 预算主体
	 * @returns 主体上限与已落账 spend
	 */
	private async _lockBudget(executor: SpendReservationExecutor, scope: SpendReservationScope): Promise<ReservationBudget> {
		await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${reservationScopeKey(scope)}))`);
		let query;
		switch (scope.kind) {
			case "key":
				query = sql`SELECT max_budget, budget_id, spend FROM "LiteLLM_VerificationToken" WHERE token = ${scope.id} FOR UPDATE`;
				break;
			case "user":
				query = sql`SELECT max_budget, spend FROM "LiteLLM_UserTable" WHERE user_id = ${scope.id} FOR UPDATE`;
				break;
			case "team":
				query = sql`SELECT max_budget, spend FROM "LiteLLM_TeamTable" WHERE team_id = ${scope.id} FOR UPDATE`;
				break;
			case "organization":
				query = sql`SELECT NULL::real AS max_budget, budget_id, spend FROM "LiteLLM_OrganizationTable" WHERE organization_id = ${scope.id} FOR UPDATE`;
				break;
			case "project":
				query = sql`SELECT NULL::real AS max_budget, budget_id, spend FROM "LiteLLM_ProjectTable" WHERE project_id::text = ${scope.id} FOR UPDATE`;
				break;
			case "team_member":
				query = sql`SELECT NULL::real AS max_budget, budget_id, spend FROM "LiteLLM_TeamMembership" WHERE user_id = ${scope.userId} AND team_id = ${scope.teamId} FOR UPDATE`;
				break;
			case "end_user":
				query = sql`SELECT NULL::real AS max_budget, budget_id, spend FROM "LiteLLM_EndUserTable" WHERE user_id = ${scope.id} FOR UPDATE`;
				break;
			default:
				throw ApiError.badRequest("不支持的预算主体类型");
		}
		const result = (await executor.execute(query)) as unknown as {
			rows: Array<{ max_budget: number | null; budget_id?: string | null; spend: number | null }>;
		};
		const row = result.rows[0];
		if (!row) {
			throw ApiError.unavailable(`预算主体不存在: ${reservationScopeKey(scope)}`);
		}
		if (row.budget_id) {
			const budgetResult = (await executor.execute(
				sql`SELECT max_budget FROM "LiteLLM_BudgetTable" WHERE budget_id::text = ${row.budget_id} FOR UPDATE`,
			)) as unknown as { rows: Array<{ max_budget: number | null }> };
			row.max_budget = budgetResult.rows[0]?.max_budget ?? null;
		}
		return { maxBudget: row.max_budget, spend: row.spend ?? 0 };
	}
}
