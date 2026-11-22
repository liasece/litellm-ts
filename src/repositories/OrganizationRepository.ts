/**
 * 组织仓储 — `LiteLLM_OrganizationTable` 与 `LiteLLM_OrganizationMembership` 的唯一访问点。
 *
 * 组织行是鉴权预算判断的主体之一（团队成员账务主体可回落到组织），按
 * `organization_id` 进入按键缓存：键走 `authRepositoryCache` 的
 * `authCacheKey.organization`，与记账提交的失效函数操作同一实例。
 *
 * 组织成员关系只被管理端按组织/按用户批量读取，没有单行热路径，故不进按键缓存——
 * 批量列表本来就不能由按键缓存服务，硬塞一份整表副本只会把「组织成员数十万」复制进内存。
 */

import { and, eq, inArray } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { BaseRepository } from "../core/db/BaseRepository";
import { LiteLLM_OrganizationTable } from "../db/schema/organizations";
import { LiteLLM_OrganizationMembership } from "../db/schema/organization-memberships";
import { authCacheKey, authRepositoryCache } from "../auth/AuthRepositoryCache";
import { singletonFor } from "./internal/registry";

/** `LiteLLM_OrganizationTable` 行。 */
export type OrganizationRow = typeof LiteLLM_OrganizationTable.$inferSelect;
/** 新建组织行时可写入的列。 */
export type OrganizationInsertValues = typeof LiteLLM_OrganizationTable.$inferInsert;
/** 更新组织行时可修改的列（缺省列不参与 UPDATE）。 */
export type OrganizationUpdateValues = Partial<typeof LiteLLM_OrganizationTable.$inferInsert>;
/** `LiteLLM_OrganizationMembership` 行。 */
export type OrganizationMembershipRow = typeof LiteLLM_OrganizationMembership.$inferSelect;
/** 新建组织成员关系时可写入的列。 */
export type OrganizationMembershipInsertValues = typeof LiteLLM_OrganizationMembership.$inferInsert;
/** 事务句柄；跨仓储写入时由调用方传入。 */
export type OrganizationTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

/**
 * 取得与数据库连接绑定的组织仓库；缓存是 `authRepositoryCache` 单例，与连接无关。
 * @param db - Drizzle 数据库实例
 */
export const organizationRepositoryFor = singletonFor((db: DrizzleDb) => new OrganizationRepository(db));

/** 组织与组织成员关系的读写实现。 */
export class OrganizationRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	/**
	 * 按主键读取组织行；命中缓存时不再查库。
	 * @param organizationId - LiteLLM_OrganizationTable.organization_id
	 * @returns 组织行或 null（负结果不缓存）
	 */
	async findById(organizationId: string): Promise<OrganizationRow | null> {
		return await authRepositoryCache.load<OrganizationRow>(authCacheKey.organization(organizationId), async () => {
			const rows = await this._db
				.select()
				.from(LiteLLM_OrganizationTable)
				.where(eq(LiteLLM_OrganizationTable.organizationId, organizationId))
				.limit(1);
			return rows.at(0) ?? null;
		});
	}

	/** 读取全部组织行；/organization/list 需要内存 join。 */
	async listAll(): Promise<OrganizationRow[]> {
		return await this._db.select().from(LiteLLM_OrganizationTable);
	}

	/**
	 * 新建组织行并返回落库后的完整行，同时写穿缓存。
	 * @param values - 可写入列
	 * @returns 插入后的组织行
	 */
	async create(values: OrganizationInsertValues): Promise<OrganizationRow> {
		const inserted = await this._db.insert(LiteLLM_OrganizationTable).values(values).returning();
		const row = inserted.at(0);
		if (row === undefined) {
			throw new Error("组织插入未返回数据行");
		}
		authRepositoryCache.set(authCacheKey.organization(row.organizationId), row);
		return row;
	}

	/**
	 * 按主键更新组织行并返回更新后的完整行。
	 * @param organizationId - 目标组织
	 * @param values - 待更新列（调用方负责 updatedAt 语义）
	 * @returns 更新后的组织行；行不存在时返回 null
	 */
	async updateById(organizationId: string, values: OrganizationUpdateValues): Promise<OrganizationRow | null> {
		const updated = await this._db
			.update(LiteLLM_OrganizationTable)
			.set(values)
			.where(eq(LiteLLM_OrganizationTable.organizationId, organizationId))
			.returning();
		const row = updated.at(0);
		if (row === undefined) {
			authRepositoryCache.delete(authCacheKey.organization(organizationId));
			return null;
		}
		authRepositoryCache.set(authCacheKey.organization(organizationId), row);
		return row;
	}

	/**
	 * 删除单个组织行。
	 * @param organizationId - 目标组织
	 * @returns 受影响行数
	 */
	async deleteById(organizationId: string): Promise<number> {
		const result = await this._db.delete(LiteLLM_OrganizationTable).where(eq(LiteLLM_OrganizationTable.organizationId, organizationId));
		authRepositoryCache.delete(authCacheKey.organization(organizationId));
		return result.rowCount ?? 0;
	}

	/**
	 * 读取组织成员关系；organizationId 为 null 时返回全部（列表端点在内存 join）。
	 * @param organizationId - 组织 ID 或 null
	 */
	async listMemberships(organizationId: string | null): Promise<OrganizationMembershipRow[]> {
		if (organizationId === null) {
			return await this._db.select().from(LiteLLM_OrganizationMembership);
		}
		return await this._db
			.select()
			.from(LiteLLM_OrganizationMembership)
			.where(eq(LiteLLM_OrganizationMembership.organizationId, organizationId));
	}

	/**
	 * 读取指定用户的组织成员关系（/user/info 的 organization_memberships）。
	 * @param userId - LiteLLM_OrganizationMembership.user_id
	 */
	async listMembershipsByUserId(userId: string): Promise<OrganizationMembershipRow[]> {
		return await this._db.select().from(LiteLLM_OrganizationMembership).where(eq(LiteLLM_OrganizationMembership.userId, userId));
	}

	/**
	 * 读取单个组织成员关系（删除前取返回体）。
	 * @param organizationId - 组织 ID
	 * @param userId - 成员用户 ID
	 * @returns 成员关系或 null
	 */
	async findMembership(organizationId: string, userId: string): Promise<OrganizationMembershipRow | null> {
		const rows = await this._db
			.select()
			.from(LiteLLM_OrganizationMembership)
			.where(
				and(eq(LiteLLM_OrganizationMembership.organizationId, organizationId), eq(LiteLLM_OrganizationMembership.userId, userId)),
			)
			.limit(1);
		return rows.at(0) ?? null;
	}

	/**
	 * 新增组织成员关系；已存在时保持原行（Python 的 on_conflict_do_nothing 语义）。
	 * @param values - 可写入列
	 */
	async insertMembership(values: OrganizationMembershipInsertValues): Promise<void> {
		await this._db.insert(LiteLLM_OrganizationMembership).values(values).onConflictDoNothing();
		authRepositoryCache.delete(authCacheKey.organization(values.organizationId));
	}

	/**
	 * 删除单个组织成员关系。
	 * @param organizationId - 组织 ID
	 * @param userId - 成员用户 ID
	 * @returns 受影响行数
	 */
	async deleteMembership(organizationId: string, userId: string): Promise<number> {
		const result = await this._db
			.delete(LiteLLM_OrganizationMembership)
			.where(
				and(eq(LiteLLM_OrganizationMembership.organizationId, organizationId), eq(LiteLLM_OrganizationMembership.userId, userId)),
			);
		authRepositoryCache.delete(authCacheKey.organization(organizationId));
		return result.rowCount ?? 0;
	}

	/**
	 * 删除用户名下全部组织成员关系（用户级联删除）。
	 * @param userIds - 用户 ID 列表
	 */
	async deleteMembershipsByUserIds(userIds: readonly string[]): Promise<void> {
		await this._db.delete(LiteLLM_OrganizationMembership).where(inArray(LiteLLM_OrganizationMembership.userId, [...userIds]));
	}

	/**
	 * 事务内锁定组织行（`SELECT ... FOR UPDATE`），供实体 PATCH 串行化读改写。
	 * @param tx - 事务句柄
	 * @param organizationId - 目标组织
	 */
	async lockByIdInTx(tx: OrganizationTransaction, organizationId: string): Promise<OrganizationRow | null> {
		const rows = await tx
			.select()
			.from(LiteLLM_OrganizationTable)
			.where(eq(LiteLLM_OrganizationTable.organizationId, organizationId))
			.for("update");
		return rows.at(0) ?? null;
	}

	/**
	 * 事务内更新组织行；列集合由业务层按请求体映射决定，类型层无法逐列收窄。
	 * @param tx - 事务句柄
	 * @param organizationId - 目标组织
	 * @param values - 待更新列（调用方已校验）
	 * @returns 更新后的组织行；行不存在时返回 null
	 */
	async updateInTx(
		tx: OrganizationTransaction,
		organizationId: string,
		values: Record<string, unknown>,
	): Promise<OrganizationRow | null> {
		const updated = await tx
			.update(LiteLLM_OrganizationTable)
			.set(values as OrganizationUpdateValues)
			.where(eq(LiteLLM_OrganizationTable.organizationId, organizationId))
			.returning();
		authRepositoryCache.delete(authCacheKey.organization(organizationId));
		return updated.at(0) ?? null;
	}
}
