/**
 * 对象权限仓储 — `LiteLLM_ObjectPermissionTable` 的唯一访问点。
 *
 * MCP 服务器/向量库/Agent 的对象级权限挂在用户、团队、组织、项目上，鉴权链按
 * `object_permission_id` 读取；行数随租户增长，因此按主键进入按键缓存：键走
 * `authRepositoryCache` 的 `authCacheKey.objectPermission`，与其它租户实体共用同一个
 * 缓存实例（同一行在进程里只保留一份副本）。
 *
 * 对象权限不参与预算结算，所以没有 subject 标签；模型改名级联写入后直接删键，
 * 下一次鉴权回落到数据库。
 */

import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { BaseRepository } from "../core/db/BaseRepository";
import { LiteLLM_ObjectPermissionTable } from "../db/schema/object-permissions";
import { authCacheKey, authRepositoryCache } from "../auth/AuthRepositoryCache";
import { singletonFor } from "./internal/registry";

/** `LiteLLM_ObjectPermissionTable` 行。 */
export type ObjectPermissionRow = typeof LiteLLM_ObjectPermissionTable.$inferSelect;
/** 新建对象权限行时可写入的列。 */
export type ObjectPermissionInsertValues = typeof LiteLLM_ObjectPermissionTable.$inferInsert;

/** 权限模型白名单投影。 */
export interface ObjectPermissionModelWhitelist {
	/** 权限行主键。 */
	readonly objectPermissionId: string;
	/** 该权限允许的模型名列表。 */
	readonly models: readonly string[] | null;
}

/**
 * 取得与数据库连接绑定的对象权限仓库；缓存是 `authRepositoryCache` 单例，与连接无关。
 * @param db - Drizzle 数据库实例
 */
export const objectPermissionRepositoryFor = singletonFor((db: DrizzleDb) => new ObjectPermissionRepository(db));

/** `LiteLLM_ObjectPermissionTable` 的读写实现。 */
export class ObjectPermissionRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	/**
	 * 按主键读取对象权限行；命中缓存时不再查库。
	 * @param objectPermissionId - LiteLLM_ObjectPermissionTable.object_permission_id
	 * @returns 权限行或 null（负结果不缓存）
	 */
	async findById(objectPermissionId: string): Promise<ObjectPermissionRow | null> {
		return await authRepositoryCache.load<ObjectPermissionRow>(authCacheKey.objectPermission(objectPermissionId), async () => {
			const rows = await this._db
				.select()
				.from(LiteLLM_ObjectPermissionTable)
				.where(eq(LiteLLM_ObjectPermissionTable.objectPermissionId, objectPermissionId))
				.limit(1);
			return rows.at(0) ?? null;
		});
	}

	/** 读取全部对象权限行；/user/list 与 /customer/list 需要内存关联。 */
	async listAll(): Promise<ObjectPermissionRow[]> {
		return await this._db.select().from(LiteLLM_ObjectPermissionTable);
	}

	/**
	 * 读取权限模型白名单投影（模型改名级联用，不需要整行）。
	 * @returns 权限主键与 models 两列
	 */
	async listModelWhitelists(): Promise<ObjectPermissionModelWhitelist[]> {
		return await this._db
			.select({
				objectPermissionId: LiteLLM_ObjectPermissionTable.objectPermissionId,
				models: LiteLLM_ObjectPermissionTable.models,
			})
			.from(LiteLLM_ObjectPermissionTable);
	}

	/**
	 * 覆盖权限行的模型白名单（模型改名级联）。
	 * @param objectPermissionId - 目标权限行
	 * @param models - 新的模型名列表
	 */
	async replaceModels(objectPermissionId: string, models: readonly string[]): Promise<void> {
		await this._db
			.update(LiteLLM_ObjectPermissionTable)
			.set({ models: [...models] })
			.where(eq(LiteLLM_ObjectPermissionTable.objectPermissionId, objectPermissionId));
		authRepositoryCache.delete(authCacheKey.objectPermission(objectPermissionId));
	}
}
