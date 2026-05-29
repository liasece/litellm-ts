/**
 * Repository 基类，提供 Drizzle 数据库实例注入
 */

import type { DrizzleDb } from "./Database";

/**
 * Repository 基类
 * 所有 Repository 通过构造函数注入共享的 Drizzle 数据库实例
 */
export abstract class BaseRepository {
	/**
	 * @param _db - Drizzle 数据库实例
	 */
	protected constructor(protected readonly _db: DrizzleDb) {}
}
