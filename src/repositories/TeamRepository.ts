/**
 * 团队仓储 — `LiteLLM_TeamTable` 与 `LiteLLM_TeamMembership` 的唯一访问点。
 *
 * 团队、成员关系都是按主键读的热点实体（鉴权链每请求要读团队与团队成员账务主体），
 * 因此按键缓存：读走 `authRepositoryCache` 的 `authCacheKey.team` /
 * `authCacheKey.teamMembership` 条目，键与标签沿用鉴权链约定；记账提交后
 * `invalidateAuthCacheForSpendSubjects` 清的是同一个实例，团队 spend 不会被旧值盖回。
 *
 * 写入成功后：有 `returning` 时写穿新值，否则删键；涉及成员关系时按 user/team 两个
 * 标签一起失效，避免「成员关系已变、团队缓存里的 members 还是旧的」。
 * 事务内写入只做失效——提交前写穿会暴露未提交值，回滚后还会留下脏读。
 */

import { and, eq, inArray } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { BaseRepository } from "../core/db/BaseRepository";
import { LiteLLM_TeamTable } from "../db/schema/teams";
import { LiteLLM_TeamMembership } from "../db/schema/team-memberships";
import { authCacheKey, authCacheTag, authRepositoryCache, invalidateAuthCacheForSubject } from "../auth/AuthRepositoryCache";
import { singletonFor } from "./internal/registry";

/** `LiteLLM_TeamTable` 行。 */
export type TeamRow = typeof LiteLLM_TeamTable.$inferSelect;
/** 新建团队行时可写入的列。 */
export type TeamInsertValues = typeof LiteLLM_TeamTable.$inferInsert;
/** 更新团队行时可修改的列（缺省列不参与 UPDATE）。 */
export type TeamUpdateValues = Partial<typeof LiteLLM_TeamTable.$inferInsert>;
/** `LiteLLM_TeamMembership` 行。 */
export type TeamMembershipRow = typeof LiteLLM_TeamMembership.$inferSelect;
/** 新建团队成员关系时可写入的列。 */
export type TeamMembershipInsertValues = typeof LiteLLM_TeamMembership.$inferInsert;
/** 事务句柄；跨仓储写入时由调用方传入。 */
export type TeamTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

/**
 * 取得与数据库连接绑定的团队仓库；缓存是 `authRepositoryCache` 单例，与连接无关。
 * @param db - Drizzle 数据库实例
 */
export const teamRepositoryFor = singletonFor((db: DrizzleDb) => new TeamRepository(db));

/** 团队与团队成员关系的读写实现。 */
export class TeamRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	/**
	 * 按主键读取团队行；命中缓存时不再查库。
	 * @param teamId - LiteLLM_TeamTable.team_id
	 * @returns 团队行或 null（负结果不缓存）
	 */
	async findById(teamId: string): Promise<TeamRow | null> {
		return await authRepositoryCache.load<TeamRow>(
			authCacheKey.team(teamId),
			async () => {
				const rows = await this._db.select().from(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.teamId, teamId)).limit(1);
				return rows.at(0) ?? null;
			},
			[authCacheTag.team(teamId)],
		);
	}

	/** 读取全部团队行；/team/list、/organization/list 需要内存 join。 */
	async listAll(): Promise<TeamRow[]> {
		return await this._db.select().from(LiteLLM_TeamTable);
	}

	/**
	 * 按 ID 批量读取团队行（/user/info 的 teams）。
	 * @param teamIds - 团队 ID 列表
	 */
	async listByIds(teamIds: readonly string[]): Promise<TeamRow[]> {
		return await this._db
			.select()
			.from(LiteLLM_TeamTable)
			.where(inArray(LiteLLM_TeamTable.teamId, [...teamIds]));
	}

	/**
	 * 读取指定组织下的团队行。
	 * @param organizationId - LiteLLM_TeamTable.organization_id
	 */
	async listByOrganizationId(organizationId: string): Promise<TeamRow[]> {
		return await this._db.select().from(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.organizationId, organizationId));
	}

	/**
	 * 读取团队模型白名单投影（模型改名级联用）。
	 * @returns team_id 与 models 两列
	 */
	async listModelWhitelists(): Promise<Array<{ readonly teamId: string; readonly models: readonly string[] | null }>> {
		return await this._db.select({ teamId: LiteLLM_TeamTable.teamId, models: LiteLLM_TeamTable.models }).from(LiteLLM_TeamTable);
	}

	/**
	 * 按主键读取团队成员关系。
	 * @param userId - LiteLLM_TeamMembership.user_id
	 * @param teamId - LiteLLM_TeamMembership.team_id
	 * @returns 成员关系或 null
	 */
	async findMembership(userId: string, teamId: string): Promise<TeamMembershipRow | null> {
		return await authRepositoryCache.load<TeamMembershipRow>(
			authCacheKey.teamMembership(userId, teamId),
			async () => {
				const rows = await this._db
					.select()
					.from(LiteLLM_TeamMembership)
					.where(and(eq(LiteLLM_TeamMembership.userId, userId), eq(LiteLLM_TeamMembership.teamId, teamId)))
					.limit(1);
				return rows.at(0) ?? null;
			},
			[authCacheTag.user(userId), authCacheTag.team(teamId)],
		);
	}

	/**
	 * 读取团队成员关系；teamId 为 null 时返回全部（列表端点在内存 join）。
	 * @param teamId - 团队 ID 或 null
	 */
	async listMemberships(teamId: string | null): Promise<TeamMembershipRow[]> {
		if (teamId === null) {
			return await this._db.select().from(LiteLLM_TeamMembership);
		}
		return await this._db.select().from(LiteLLM_TeamMembership).where(eq(LiteLLM_TeamMembership.teamId, teamId));
	}

	/**
	 * 读取指定用户的全部团队成员关系（/user/info）。
	 * @param userId - LiteLLM_TeamMembership.user_id
	 */
	async listMembershipsByUserId(userId: string): Promise<TeamMembershipRow[]> {
		return await this._db.select().from(LiteLLM_TeamMembership).where(eq(LiteLLM_TeamMembership.userId, userId));
	}

	/**
	 * 新建团队行并返回落库后的完整行，同时写穿缓存。
	 * @param values - 可写入列
	 * @returns 插入后的团队行
	 */
	async create(values: TeamInsertValues): Promise<TeamRow> {
		const inserted = await this._db.insert(LiteLLM_TeamTable).values(values).returning();
		const row = inserted.at(0);
		if (row === undefined) {
			throw new Error("团队插入未返回数据行");
		}
		authRepositoryCache.set(authCacheKey.team(row.teamId), row, [authCacheTag.team(row.teamId)]);
		return row;
	}

	/**
	 * 按主键更新团队行并返回更新后的完整行。
	 * @param teamId - 目标团队
	 * @param values - 待更新列（调用方负责 updatedAt 语义）
	 * @returns 更新后的团队行；行不存在时返回 null
	 */
	async updateById(teamId: string, values: TeamUpdateValues): Promise<TeamRow | null> {
		const updated = await this._db.update(LiteLLM_TeamTable).set(values).where(eq(LiteLLM_TeamTable.teamId, teamId)).returning();
		const row = updated.at(0);
		if (row === undefined) {
			return null;
		}
		authRepositoryCache.set(authCacheKey.team(teamId), row, [authCacheTag.team(teamId)]);
		return row;
	}

	/**
	 * 只更新封禁状态（/team/block、/team/unblock）。
	 *
	 * 单独成方法是因为调用方只需要 rowCount 判存在性，不需要整行；写入后失效缓存，
	 * 保证「封团队」对下一次鉴权立即生效。
	 * @param teamId - 目标团队
	 * @param blocked - 目标封禁状态
	 * @returns 受影响行数
	 */
	async setBlocked(teamId: string, blocked: boolean): Promise<number> {
		const result = await this._db
			.update(LiteLLM_TeamTable)
			.set({ blocked: blocked, updatedAt: new Date() })
			.where(eq(LiteLLM_TeamTable.teamId, teamId));
		this._invalidateTeam(teamId);
		return result.rowCount ?? 0;
	}

	/**
	 * 覆盖团队模型白名单（/team/model/add、/team/model/delete 与模型改名级联）。
	 * @param teamId - 目标团队
	 * @param models - 新的模型名列表
	 * @param updatedAt - 是否同时刷新 updatedAt；改名级联沿用 Python 只改 models 的语义
	 */
	async replaceModels(teamId: string, models: readonly string[], updatedAt?: Date): Promise<void> {
		const values: TeamUpdateValues = updatedAt === undefined ? { models: [...models] } : { models: [...models], updatedAt: updatedAt };
		await this._db.update(LiteLLM_TeamTable).set(values).where(eq(LiteLLM_TeamTable.teamId, teamId));
		this._invalidateTeam(teamId);
	}

	/**
	 * 按主键批量删除团队行。
	 * @param teamIds - 团队 ID 列表
	 * @returns 实际删除行数
	 */
	async deleteByIds(teamIds: readonly string[]): Promise<number> {
		const result = await this._db.delete(LiteLLM_TeamTable).where(inArray(LiteLLM_TeamTable.teamId, [...teamIds]));
		for (const teamId of teamIds) {
			this._invalidateTeam(teamId);
		}
		return result.rowCount ?? 0;
	}

	/**
	 * 事务内锁定团队行（`SELECT ... FOR UPDATE`），供实体 PATCH 串行化读改写。
	 * @param tx - 事务句柄
	 * @param teamId - 目标团队
	 */
	async lockByIdInTx(tx: TeamTransaction, teamId: string): Promise<TeamRow | null> {
		const rows = await tx.select().from(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.teamId, teamId)).for("update");
		return rows.at(0) ?? null;
	}

	/**
	 * 事务内更新团队行；列集合由业务层按请求体映射决定，类型层无法逐列收窄。
	 * @param tx - 事务句柄
	 * @param teamId - 目标团队
	 * @param values - 待更新列（调用方已校验）
	 * @returns 更新后的团队行；行不存在时返回 null
	 */
	async updateInTx(tx: TeamTransaction, teamId: string, values: Record<string, unknown>): Promise<TeamRow | null> {
		const updated = await tx
			.update(LiteLLM_TeamTable)
			.set(values as TeamUpdateValues)
			.where(eq(LiteLLM_TeamTable.teamId, teamId))
			.returning();
		this._invalidateTeam(teamId);
		return updated.at(0) ?? null;
	}

	/**
	 * 新增团队成员关系；已存在时保持原行（Python 的 on_conflict_do_nothing 语义）。
	 * @param values - 可写入列
	 */
	async insertMembership(values: TeamMembershipInsertValues): Promise<void> {
		await this._db.insert(LiteLLM_TeamMembership).values(values).onConflictDoNothing();
		invalidateAuthCacheForSubject({ userId: values.userId, teamId: values.teamId });
	}

	/**
	 * 删除单个团队成员关系。
	 * @param userId - 成员用户 ID
	 * @param teamId - 团队 ID
	 * @returns 受影响行数
	 */
	async deleteMembership(userId: string, teamId: string): Promise<number> {
		const result = await this._db
			.delete(LiteLLM_TeamMembership)
			.where(and(eq(LiteLLM_TeamMembership.userId, userId), eq(LiteLLM_TeamMembership.teamId, teamId)));
		invalidateAuthCacheForSubject({ userId: userId, teamId: teamId });
		return result.rowCount ?? 0;
	}

	/**
	 * 删除团队名下全部成员关系（团队级联删除）。
	 * @param teamIds - 团队 ID 列表
	 */
	async deleteMembershipsByTeamIds(teamIds: readonly string[]): Promise<void> {
		await this._db.delete(LiteLLM_TeamMembership).where(inArray(LiteLLM_TeamMembership.teamId, [...teamIds]));
		for (const teamId of teamIds) {
			invalidateAuthCacheForSubject({ teamId: teamId });
		}
	}

	/**
	 * 删除用户名下全部团队成员关系（用户级联删除）。
	 * @param userIds - 用户 ID 列表
	 */
	async deleteMembershipsByUserIds(userIds: readonly string[]): Promise<void> {
		await this._db.delete(LiteLLM_TeamMembership).where(inArray(LiteLLM_TeamMembership.userId, [...userIds]));
		for (const userId of userIds) {
			invalidateAuthCacheForSubject({ userId: userId });
		}
	}

	/**
	 * 失效某个团队的缓存与主体标签（成员关系也按 team 标签清掉）。
	 * @param teamId - 团队 ID
	 */
	private _invalidateTeam(teamId: string): void {
		invalidateAuthCacheForSubject({ teamId: teamId });
	}
}
