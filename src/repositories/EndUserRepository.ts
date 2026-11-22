/**
 * 端用户仓储 — `LiteLLM_EndUserTable` 的唯一访问点。
 *
 * 端用户（customer）行参与鉴权预算判断（`end_user` 账务主体），按 `user_id` 进入
 * 按键缓存：键走 `authRepositoryCache` 的 `authCacheKey.endUser`，与记账提交的
 * `invalidateAuthCacheForSpendSubjects` 操作同一实例。
 */

import { and, eq, ilike, inArray } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { BaseRepository } from "../core/db/BaseRepository";
import { LiteLLM_EndUserTable } from "../db/schema/end-users";
import { authCacheKey, authRepositoryCache } from "../auth/AuthRepositoryCache";
import { singletonFor } from "./internal/registry";

/** `LiteLLM_EndUserTable` 行。 */
export type EndUserRow = typeof LiteLLM_EndUserTable.$inferSelect;
/** 新建端用户行时可写入的列。 */
export type EndUserInsertValues = typeof LiteLLM_EndUserTable.$inferInsert;
/** 更新端用户行时可修改的列（缺省列不参与 UPDATE）。 */
export type EndUserUpdateValues = Partial<typeof LiteLLM_EndUserTable.$inferInsert>;
/** `/customer/list` 的过滤与截断参数。 */
export interface EndUserListFilters {
	/** user_id 的大小写不敏感子串；空串表示不过滤。 */
	readonly search?: string;
	/** 需要截断的行数；undefined 表示不截断（对齐 Python 全量返回）。 */
	readonly limit?: number;
}

/**
 * 取得与数据库连接绑定的端用户仓库；缓存是 `authRepositoryCache` 单例，与连接无关。
 * @param db - Drizzle 数据库实例
 */
export const endUserRepositoryFor = singletonFor((db: DrizzleDb) => new EndUserRepository(db));

/** `LiteLLM_EndUserTable` 的读写实现。 */
export class EndUserRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	/**
	 * 按主键读取端用户行；命中缓存时不再查库。
	 * @param userId - LiteLLM_EndUserTable.user_id
	 * @returns 端用户行或 null（负结果不缓存）
	 */
	async findById(userId: string): Promise<EndUserRow | null> {
		return await authRepositoryCache.load<EndUserRow>(authCacheKey.endUser(userId), async () => {
			const rows = await this._db.select().from(LiteLLM_EndUserTable).where(eq(LiteLLM_EndUserTable.userId, userId)).limit(1);
			return rows.at(0) ?? null;
		});
	}

	/** 读取全部端用户行。 */
	async listAll(): Promise<EndUserRow[]> {
		return await this._db.select().from(LiteLLM_EndUserTable);
	}

	/**
	 * 按 ID 批量读取端用户行（批量删除前的存在性校验）。
	 * @param userIds - 端用户 ID 列表
	 */
	async listByIds(userIds: readonly string[]): Promise<EndUserRow[]> {
		return await this._db
			.select()
			.from(LiteLLM_EndUserTable)
			.where(inArray(LiteLLM_EndUserTable.userId, [...userIds]));
	}

	/**
	 * `/customer/list` 的查询：按 user_id 子串过滤并固定排序，可选截断。
	 * @param filters - 过滤与截断参数
	 */
	async list(filters: EndUserListFilters): Promise<EndUserRow[]> {
		const conditions =
			filters.search === undefined || filters.search.length === 0
				? []
				: [ilike(LiteLLM_EndUserTable.userId, containsPattern(filters.search))];
		const query = this._db
			.select()
			.from(LiteLLM_EndUserTable)
			.where(and(...conditions))
			.orderBy(LiteLLM_EndUserTable.userId);
		return filters.limit === undefined ? await query : await query.limit(filters.limit);
	}

	/**
	 * 新建端用户行并返回落库后的完整行，同时写穿缓存。
	 * @param values - 可写入列
	 * @returns 插入后的端用户行
	 */
	async create(values: EndUserInsertValues): Promise<EndUserRow> {
		const inserted = await this._db.insert(LiteLLM_EndUserTable).values(values).returning();
		const row = inserted.at(0);
		if (row === undefined) {
			throw new Error("端用户插入未返回数据行");
		}
		authRepositoryCache.set(authCacheKey.endUser(row.userId), row);
		return row;
	}

	/**
	 * 按主键更新端用户行并返回更新后的完整行。
	 * @param userId - 目标端用户
	 * @param values - 待更新列
	 * @returns 更新后的端用户行；行不存在时返回 null
	 */
	async updateById(userId: string, values: EndUserUpdateValues): Promise<EndUserRow | null> {
		const updated = await this._db.update(LiteLLM_EndUserTable).set(values).where(eq(LiteLLM_EndUserTable.userId, userId)).returning();
		const row = updated.at(0);
		if (row === undefined) {
			authRepositoryCache.delete(authCacheKey.endUser(userId));
			return null;
		}
		authRepositoryCache.set(authCacheKey.endUser(userId), row);
		return row;
	}

	/**
	 * 只更新封禁状态（/customer/block、/customer/unblock）。
	 * @param userId - 目标端用户
	 * @param blocked - 目标封禁状态
	 * @returns 受影响行数
	 */
	async setBlocked(userId: string, blocked: boolean): Promise<number> {
		const result = await this._db.update(LiteLLM_EndUserTable).set({ blocked: blocked }).where(eq(LiteLLM_EndUserTable.userId, userId));
		authRepositoryCache.delete(authCacheKey.endUser(userId));
		return result.rowCount ?? 0;
	}

	/**
	 * 按主键批量删除端用户行。
	 * @param userIds - 端用户 ID 列表
	 * @returns 实际删除行数
	 */
	async deleteByIds(userIds: readonly string[]): Promise<number> {
		const result = await this._db.delete(LiteLLM_EndUserTable).where(inArray(LiteLLM_EndUserTable.userId, [...userIds]));
		for (const userId of userIds) {
			authRepositoryCache.delete(authCacheKey.endUser(userId));
		}
		return result.rowCount ?? 0;
	}
}

/**
 * 大小写不敏感包含匹配的 LIKE 模式；转义用户输入里的通配符。
 * @param value - 已 trim 的搜索词
 */
function containsPattern(value: string): string {
	return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}
