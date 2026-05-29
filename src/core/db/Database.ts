/**
 * PostgreSQL 数据库管理器
 * 使用 Drizzle ORM + node-postgres 驱动，提供类型安全的数据库访问
 */

import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as path from "path";
import * as schema from "../../db/schema";
import { createModuleLogger } from "../utils/logger";
import type { DatabaseConfig } from "../config";

const logger = createModuleLogger("Database");

/** Drizzle 数据库实例类型（带 schema 类型推导） */
export type DrizzleDb = NodePgDatabase<typeof schema>;

/**
 * PostgreSQL 数据库管理器
 * 封装 pg.Pool + Drizzle ORM，提供连接池管理和 schema 迁移
 */
export class Database {
	/** pg 连接池 */
	private readonly _pool: pg.Pool;
	/** Drizzle ORM 数据库实例 */
	private readonly _db: DrizzleDb;

	/**
	 * @param config - 数据库连接配置
	 */
	constructor(config: DatabaseConfig) {
		this._pool = new pg.Pool({
			host: config.host,
			port: config.port,
			database: config.database,
			user: config.user,
			password: config.password,
		});

		this._db = drizzle(this._pool, { schema: schema });
	}

	/**
	 * 获取 Drizzle 数据库实例（供 Repository 使用）
	 */
	get db(): DrizzleDb {
		return this._db;
	}

	/**
	 * 初始化数据库：运行 Drizzle 迁移
	 * 使用 __dirname 定位迁移目录（编译后在 dist/core/db/，向上三级到项目根目录）
	 */
	async initialize(): Promise<void> {
		const migrationsFolder = path.join(__dirname, "../../../drizzle");
		await migrate(this._db, { migrationsFolder: migrationsFolder });
		logger.info("数据库迁移已完成");
	}

	/**
	 * 关闭数据库连接池
	 */
	async close(): Promise<void> {
		await this._pool.end();
		logger.info("数据库连接池已关闭");
	}
}
