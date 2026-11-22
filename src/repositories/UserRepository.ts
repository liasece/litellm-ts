/**
 * 用户仓储 — `LiteLLM_UserTable` 的唯一访问点。
 *
 * 用户行随租户增长，按 `user_id` 进入按键缓存：读走 `authRepositoryCache` 里已有的
 * `authCacheKey.user` 条目，键与标签沿用鉴权链约定，因此鉴权（`UserApiKeyAuth` →
 * `AuthRepository`）与管理端 /user/* 读的是同一份行副本。
 *
 * 写入成功后写穿（插入带 `returning` 时）或删掉键并清理主体标签：记账提交用
 * `invalidateAuthCacheForSpendSubjects` 清的是同一个缓存实例，结算后的 spend 不会
 * 被第二份缓存盖回旧值。
 */

import { eq, inArray } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { BaseRepository } from "../core/db/BaseRepository";
import { LiteLLM_UserTable } from "../db/schema/users";
import { authCacheKey, authCacheTag, authRepositoryCache, invalidateAuthCacheForSubject } from "../auth/AuthRepositoryCache";
import { singletonFor } from "./internal/registry";

/** `LiteLLM_UserTable` 行。 */
export type UserRow = typeof LiteLLM_UserTable.$inferSelect;
/** 新建用户行时可写入的列。 */
export type UserInsertValues = typeof LiteLLM_UserTable.$inferInsert;
/** 更新用户行时可修改的列（缺省列不参与 UPDATE）。 */
export type UserUpdateValues = Partial<typeof LiteLLM_UserTable.$inferInsert>;
/** 事务句柄；跨仓储写入时由调用方传入。 */
export type UserTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

/**
 * 取得与数据库连接绑定的用户仓库；缓存是 `authRepositoryCache` 单例，与连接无关。
 * @param db - Drizzle 数据库实例
 */
export const userRepositoryFor = singletonFor((db: DrizzleDb) => new UserRepository(db));

/** `LiteLLM_UserTable` 的读写实现。 */
export class UserRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	/**
	 * 按主键读取用户行；命中缓存时不再查库。
	 * @param userId - LiteLLM_UserTable.user_id
	 * @returns 用户行或 null（负结果不缓存）
	 */
	async findById(userId: string): Promise<UserRow | null> {
		return await authRepositoryCache.load<UserRow>(
			authCacheKey.user(userId),
			async () => {
				const rows = await this._db.select().from(LiteLLM_UserTable).where(eq(LiteLLM_UserTable.userId, userId)).limit(1);
				return rows.at(0) ?? null;
			},
			[authCacheTag.user(userId)],
		);
	}

	/** 读取全部用户行；/user/list 需要内存 join，不做整表副本。 */
	async listAll(): Promise<UserRow[]> {
		return await this._db.select().from(LiteLLM_UserTable);
	}

	/**
	 * 新建用户行并返回落库后的完整行。
	 *
	 * 团队/组织成员接口在用户不存在时补建用户，需要立刻把行返回给调用方拼响应；
	 * 写入成功后写穿缓存，避免紧接着的鉴权再查一次库。
	 * @param values - 可写入列
	 * @returns 插入后的用户行
	 */
	async create(values: UserInsertValues): Promise<UserRow> {
		const inserted = await this._db.insert(LiteLLM_UserTable).values(values).returning();
		const row = inserted.at(0);
		if (row === undefined) {
			throw new Error("用户插入未返回数据行");
		}
		authRepositoryCache.set(authCacheKey.user(row.userId), row, [authCacheTag.user(row.userId)]);
		return row;
	}

	/**
	 * 新建用户行但不回读。
	 *
	 * /user/new 的响应完全由请求体拼装，插入语句不需要 `returning`；缓存只失效，
	 * 下一次读取回落到数据库。
	 * @param values - 可写入列
	 */
	async insert(values: UserInsertValues): Promise<void> {
		await this._db.insert(LiteLLM_UserTable).values(values);
		invalidateAuthCacheForSubject({ userId: values.userId });
	}

	/**
	 * 按主键更新用户行；成功后失效该用户的缓存与主体标签。
	 * @param userId - 目标用户
	 * @param values - 待更新列（调用方负责 updatedAt 语义）
	 * @returns 受影响行数
	 */
	async updateById(userId: string, values: UserUpdateValues): Promise<number> {
		const result = await this._db.update(LiteLLM_UserTable).set(values).where(eq(LiteLLM_UserTable.userId, userId));
		invalidateAuthCacheForSubject({ userId: userId });
		return result.rowCount ?? 0;
	}

	/**
	 * 按主键批量删除用户行。
	 * @param userIds - 用户 ID 列表
	 * @returns 实际删除行数
	 */
	async deleteByIds(userIds: readonly string[]): Promise<number> {
		const result = await this._db.delete(LiteLLM_UserTable).where(inArray(LiteLLM_UserTable.userId, [...userIds]));
		for (const userId of userIds) {
			invalidateAuthCacheForSubject({ userId: userId });
		}
		return result.rowCount ?? 0;
	}
}
