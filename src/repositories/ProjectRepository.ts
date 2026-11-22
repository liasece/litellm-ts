/**
 * 项目仓储 — `LiteLLM_ProjectTable` 的唯一访问点。
 *
 * 项目是鉴权预算判断的主体之一（`project` 账务主体），按 `project_id` 进入按键缓存：
 * 键走 `authRepositoryCache` 的 `authCacheKey.project`，与记账提交的
 * `invalidateAuthCacheForSpendSubjects` 操作同一实例，结算后不会读到旧 spend。
 *
 * 本仓储只承载管理端与鉴权链当前需要的读取能力；项目端点自身仍由其他模块维护。
 */

import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { BaseRepository } from "../core/db/BaseRepository";
import { LiteLLM_ProjectTable } from "../db/schema/projects";
import { authCacheKey, authRepositoryCache } from "../auth/AuthRepositoryCache";
import { singletonFor } from "./internal/registry";

/** `LiteLLM_ProjectTable` 行。 */
export type ProjectRow = typeof LiteLLM_ProjectTable.$inferSelect;
/** 新建项目行时可写入的列。 */
export type ProjectInsertValues = typeof LiteLLM_ProjectTable.$inferInsert;

/**
 * 取得与数据库连接绑定的项目仓库；缓存是 `authRepositoryCache` 单例，与连接无关。
 * @param db - Drizzle 数据库实例
 */
export const projectRepositoryFor = singletonFor((db: DrizzleDb) => new ProjectRepository(db));

/** `LiteLLM_ProjectTable` 的读实现。 */
export class ProjectRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	/**
	 * 按主键读取项目行；命中缓存时不再查库。
	 * @param projectId - LiteLLM_ProjectTable.project_id
	 * @returns 项目行或 null（负结果不缓存）
	 */
	async findById(projectId: string): Promise<ProjectRow | null> {
		return await authRepositoryCache.load<ProjectRow>(authCacheKey.project(projectId), async () => {
			const rows = await this._db.select().from(LiteLLM_ProjectTable).where(eq(LiteLLM_ProjectTable.projectId, projectId)).limit(1);
			return rows.at(0) ?? null;
		});
	}
}
