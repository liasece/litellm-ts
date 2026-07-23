/**
 * PostgreSQL 数据库管理器
 * 使用 Drizzle ORM + node-postgres 驱动，提供类型安全的数据库访问
 */

import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import pg from "pg";
import type { PoolConfig, PoolClient } from "pg";
import * as path from "path";
import * as schema from "../../db/schema";
import { createModuleLogger } from "../utils/logger";
import type { DatabaseConfig } from "../config";
import { runSchemaPreflight } from "./SchemaPreflight";

const logger = createModuleLogger("Database");
const MIGRATION_LOCK_ID = 741_932_611;

/** Drizzle 数据库实例类型（带 schema 类型推导） */
export type DrizzleDb = NodePgDatabase<typeof schema>;

/** 数据库 readiness probe 的脱敏结果。 */
export type DatabaseReadinessResult =
	| { readonly ready: true }
	| { readonly ready: false; readonly reason: "not_initialized" | "query_failed" };

/** 生产数据库只读接管门禁结果。 */
export interface ReadOnlyPreflightResult {
	/**
	 *
	 */
	readonly status: "ok";
	/**
	 *
	 */
	readonly check: "production_database";
	/**
	 *
	 */
	readonly transaction: "read_only";
	/**
	 *
	 */
	readonly schema: string;
	/**
	 *
	 */
	readonly migrationState: "unadopted" | "managed";
}

/** 生产数据库只读接管门禁的脱敏错误。 */
export class ReadOnlyPreflightError extends Error {
	/**
	 * @param stage - 失败阶段
	 * @param code - 稳定错误码
	 * @param message - 脱敏错误信息
	 */
	constructor(
		readonly stage: "connect" | "transaction" | "schema" | "migrations",
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "ReadOnlyPreflightError";
	}
}

function positiveInteger(value: string | null): number | undefined {
	if (value === null || !/^\d+$/.test(value)) {
		return undefined;
	}
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function buildPoolConfig(config: DatabaseConfig): PoolConfig {
	if (!config.connectionString) {
		return {
			host: config.host,
			port: config.port,
			database: config.database,
			user: config.user,
			password: config.password,
			max: config.maxConnections,
		};
	}

	const parsed = new URL(config.connectionString);
	const connectTimeoutSeconds = positiveInteger(parsed.searchParams.get("connect_timeout"));
	const poolTimeoutSeconds = positiveInteger(parsed.searchParams.get("pool_timeout"));
	const connectionLimit = positiveInteger(parsed.searchParams.get("connection_limit"));
	const schemaName = parsed.searchParams.get("schema");
	let options = parsed.searchParams.get("options") ?? undefined;
	if (schemaName !== null && !/(?:^|\s)search_path\s*=/.test(options ?? "")) {
		if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(schemaName)) {
			throw new Error("Invalid PostgreSQL schema parameter");
		}
		options = `${options ? `${options} ` : ""}-c search_path=${schemaName}`;
	}

	return {
		connectionString: config.connectionString,
		max: config.maxConnections ?? connectionLimit,
		connectionTimeoutMillis:
			(connectTimeoutSeconds ?? poolTimeoutSeconds) !== undefined
				? (connectTimeoutSeconds ?? poolTimeoutSeconds)! * 1_000
				: undefined,
		options: options,
	};
}

async function countLiteLLMTables(client: PoolClient): Promise<number> {
	const result = await client.query<{ table_count: string }>(`
		SELECT count(*)::text AS table_count
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = current_schema()
		  AND c.relkind = 'r'
		  AND c.relname LIKE 'LiteLLM\\_%' ESCAPE '\\'`);
	return Number(result.rows[0]?.table_count ?? "0");
}

function quoteIdentifier(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

async function currentSchema(client: PoolClient): Promise<string> {
	const result = await client.query<{ schema_name: string | null }>("SELECT current_schema() AS schema_name");
	const schemaName = result.rows[0]?.schema_name;
	if (!schemaName) {
		throw new Error("PostgreSQL current schema is unavailable");
	}
	return schemaName;
}

async function adoptBaseline(client: PoolClient, migrationsFolder: string, migrationSchema: string): Promise<void> {
	const baseline = readMigrationFiles({ migrationsFolder: migrationsFolder })[0];
	if (!baseline) {
		throw new Error("Drizzle migration baseline is missing");
	}
	const migrationTable = `${quoteIdentifier(migrationSchema)}."__drizzle_migrations"`;
	await client.query(`
		CREATE TABLE IF NOT EXISTS ${migrationTable} (
			id SERIAL PRIMARY KEY,
			hash text NOT NULL,
			created_at bigint
		)`);
	const latest = await client.query<{ created_at: string | null }>(
		`select id, hash, created_at from ${migrationTable} order by created_at desc limit 1`,
	);
	if (Number(latest.rows[0]?.created_at ?? 0) < baseline.folderMillis) {
		await client.query(`INSERT INTO ${migrationTable} (hash, created_at) VALUES ($1, $2)`, [baseline.hash, baseline.folderMillis]);
	}
}

interface MigrationRecord {
	/** 已登记 migration hash。 */
	readonly hash: string;
	/** 已登记 migration 时间戳。 */
	readonly created_at: string | null;
}

async function inspectMigrationState(
	client: PoolClient,
	schemaName: string,
	migrationsFolder: string,
): Promise<ReadOnlyPreflightResult["migrationState"]> {
	const localMigrations = readMigrationFiles({ migrationsFolder: migrationsFolder });
	if (localMigrations.length === 0) {
		throw new ReadOnlyPreflightError("migrations", "LOCAL_MIGRATIONS_MISSING", "Local Drizzle migrations are unavailable");
	}
	const existence = await client.query<{ exists: boolean }>(
		"SELECT to_regclass(format('%I.%I', current_schema(), '__drizzle_migrations')) IS NOT NULL AS exists",
	);
	if (existence.rows[0]?.exists !== true) {
		return "unadopted";
	}

	const migrationTable = `${quoteIdentifier(schemaName)}."__drizzle_migrations"`;
	const registered = await client.query<MigrationRecord>(`SELECT hash, created_at FROM ${migrationTable} ORDER BY id ASC`);
	const localHashes = new Set(localMigrations.map((migration) => migration.hash));
	for (const record of registered.rows) {
		if (!localHashes.has(record.hash)) {
			const timestampMatches = localMigrations.some((migration) => migration.folderMillis === Number(record.created_at));
			throw new ReadOnlyPreflightError(
				"migrations",
				timestampMatches ? "MIGRATION_ARTIFACT_MISMATCH" : "UNKNOWN_MIGRATION",
				timestampMatches ? "Registered migration does not match the local artifact" : "Unknown migration is registered",
			);
		}
	}
	if (registered.rows.length !== localMigrations.length) {
		throw new ReadOnlyPreflightError("migrations", "PARTIAL_MIGRATION_STATE", "Registered migrations are incomplete");
	}
	for (const [index, migration] of localMigrations.entries()) {
		const record = registered.rows[index];
		if (record?.hash !== migration.hash || Number(record.created_at) !== migration.folderMillis) {
			throw new ReadOnlyPreflightError("migrations", "MIGRATION_ORDER_MISMATCH", "Registered migration order is invalid");
		}
	}
	return "managed";
}

/**
 * 在短生命周期只读事务中验证生产数据库可由当前 TS 工件接管。
 * @param config - 数据库连接配置
 */
export async function runReadOnlySchemaPreflight(config: DatabaseConfig): Promise<ReadOnlyPreflightResult> {
	const pool = new pg.Pool(buildPoolConfig(config));
	let client: PoolClient | undefined;
	let transactionOpen = false;
	let stage: ReadOnlyPreflightError["stage"] = "connect";
	try {
		client = await pool.connect();
		stage = "transaction";
		await client.query("BEGIN READ ONLY");
		transactionOpen = true;
		await client.query("SELECT 1");
		stage = "schema";
		const identity = await client.query<{ database_name: string; schema_name: string | null }>(
			"SELECT current_database() AS database_name, current_schema() AS schema_name",
		);
		const databaseName = identity.rows[0]?.database_name;
		const schemaName = identity.rows[0]?.schema_name;
		if (!databaseName || !schemaName) {
			throw new ReadOnlyPreflightError("schema", "DATABASE_IDENTITY_UNAVAILABLE", "Database identity is unavailable");
		}
		await runSchemaPreflight(client);
		stage = "migrations";
		const migrationsFolder = path.join(__dirname, "../../../drizzle");
		const migrationState = await inspectMigrationState(client, schemaName, migrationsFolder);
		await client.query("COMMIT");
		transactionOpen = false;
		return {
			status: "ok",
			check: "production_database",
			transaction: "read_only",
			schema: schemaName,
			migrationState: migrationState,
		};
	} catch (error) {
		if (client && transactionOpen) {
			await client.query("ROLLBACK").catch(() => undefined);
		}
		if (error instanceof ReadOnlyPreflightError) {
			throw error;
		}
		throw new ReadOnlyPreflightError(stage, "PREFLIGHT_FAILED", "PostgreSQL read-only preflight failed");
	} finally {
		client?.release();
		await pool.end();
	}
}

/**
 * PostgreSQL 数据库管理器
 * 封装 pg.Pool + Drizzle ORM，提供连接池管理和 schema 迁移
 */
export class Database {
	/** pg 连接池 */
	private readonly _pool: pg.Pool;
	/** Drizzle ORM 数据库实例 */
	private readonly _db: DrizzleDb;
	/** 数据库迁移是否已成功完成。 */
	private _initialized = false;

	/** @param config - 数据库连接配置 */
	constructor(config: DatabaseConfig) {
		this._pool = new pg.Pool(buildPoolConfig(config));
		this._db = drizzle(this._pool, { schema: schema });
	}

	/** 获取 Drizzle 数据库实例（供 Repository 使用） */
	get db(): DrizzleDb {
		return this._db;
	}

	/**
	 * 初始化数据库：连接、只读 preflight、一次性 adoption baseline、受锁迁移。
	 * 空库执行完整 bootstrap；既有 Python LiteLLM 库先核验再登记 baseline。
	 */
	async initialize(): Promise<void> {
		this._initialized = false;
		const migrationsFolder = path.join(__dirname, "../../../drizzle");
		const client = await this._pool.connect();
		let locked = false;
		try {
			await client.query("SELECT 1");
			await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
			locked = true;
			const migrationSchema = await currentSchema(client);
			const existingTableCount = await countLiteLLMTables(client);
			if (existingTableCount > 0) {
				await runSchemaPreflight(client);
				await adoptBaseline(client, migrationsFolder, migrationSchema);
			}

			const migrationDb = drizzle(client, { schema: schema });
			await migrate(migrationDb, { migrationsFolder: migrationsFolder, migrationsSchema: migrationSchema });
			await runSchemaPreflight(client);
			this._initialized = true;
			logger.info(existingTableCount > 0 ? "数据库接管与迁移已完成" : "空数据库 bootstrap 与迁移已完成");
		} finally {
			if (locked) {
				await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => undefined);
			}
			client.release();
		}
	}

	/** 检查数据库是否已完成初始化且连接可执行查询。 */
	async probeReadiness(): Promise<DatabaseReadinessResult> {
		if (!this._initialized) {
			return { ready: false, reason: "not_initialized" };
		}
		try {
			await this._pool.query("SELECT 1");
			return { ready: true };
		} catch {
			return { ready: false, reason: "query_failed" };
		}
	}

	/** 关闭数据库连接池 */
	async close(): Promise<void> {
		await this._pool.end();
		this._initialized = false;
		logger.info("数据库连接池已关闭");
	}
}
