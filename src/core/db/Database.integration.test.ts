import { readFileSync } from "fs";
import { resolve } from "path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Pool } from "pg";
import type { DatabaseConfig } from "../config";
import { Database, runReadOnlySchemaPreflight } from "./Database";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

function databaseConfig(connectionString: string): DatabaseConfig {
	const parsed = new URL(connectionString);
	return {
		host: parsed.hostname,
		port: parsed.port ? Number(parsed.port) : 5432,
		database: parsed.pathname.replace(/^\//, ""),
		user: parsed.username,
		password: parsed.password,
		connectionString: connectionString,
		maxConnections: 2,
	};
}

describeWithDatabase("Database PostgreSQL bootstrap integration", () => {
	const schemaName = `litellm_bootstrap_${process.pid}_${Date.now()}`;
	let adminPool: Pool;
	let schemaPool: Pool;
	let connectionString: string;

	beforeAll(async () => {
		adminPool = new Pool({ connectionString: testDatabaseUrl });
		await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
		const parsed = new URL(testDatabaseUrl!);
		parsed.searchParams.set("schema", schemaName);
		connectionString = parsed.toString();
		schemaPool = new Pool({ connectionString: testDatabaseUrl, options: `-c search_path=${schemaName}` });
	});

	afterAll(async () => {
		if (schemaPool) {
			await schemaPool.end();
		}
		if (adminPool) {
			await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
			await adminPool.end();
		}
	});

	it("advisory lock 串行化空库 bootstrap，并允许后续 managed 初始化", async () => {
		const first = new Database(databaseConfig(connectionString));
		const contender = new Database(databaseConfig(connectionString));
		await Promise.all([first.initialize(), contender.initialize()]);
		await expect(first.probeReadiness()).resolves.toEqual({ ready: true });
		await expect(contender.probeReadiness()).resolves.toEqual({ ready: true });
		await Promise.all([first.close(), contender.close()]);

		const tables = await schemaPool.query<{ table_name: string }>(
			"SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()",
		);
		expect(tables.rows.some((row) => row.table_name === "LiteLLM_VerificationToken")).toBe(true);
		expect(tables.rows.some((row) => row.table_name === "LiteLLM_SpendReservations")).toBe(true);
		const migrations = await schemaPool.query<{ count: string }>('SELECT count(*)::text AS count FROM "__drizzle_migrations"');
		expect(Number(migrations.rows[0]?.count)).toBe(2);

		const second = new Database(databaseConfig(connectionString));
		await second.initialize();
		await expect(second.probeReadiness()).resolves.toEqual({ ready: true });
		await second.close();
	});
});

describeWithDatabase("Production database read-only takeover integration", () => {
	const schemaName = `litellm_preflight_${process.pid}_${Date.now()}`;
	const localMigrations = readMigrationFiles({ migrationsFolder: resolve(__dirname, "../../../drizzle") });
	let adminPool: Pool;
	let schemaPool: Pool;
	let connectionString: string;

	beforeAll(async () => {
		adminPool = new Pool({ connectionString: testDatabaseUrl });
		await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
		const parsed = new URL(testDatabaseUrl!);
		parsed.searchParams.set("schema", schemaName);
		connectionString = parsed.toString();
		schemaPool = new Pool({ connectionString: testDatabaseUrl, options: `-c search_path=${schemaName}` });
		const baselineSql = readFileSync(resolve(__dirname, "../../../drizzle/0000_python_litellm_baseline.sql"), "utf8");
		await schemaPool.query(baselineSql);
	});

	afterAll(async () => {
		if (schemaPool) {
			await schemaPool.end();
		}
		if (adminPool) {
			await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
			await adminPool.end();
		}
	});

	it("只读门禁不写表，随后 adoption/migration 与重复初始化幂等", async () => {
		await expect(runReadOnlySchemaPreflight(databaseConfig(connectionString))).resolves.toMatchObject({
			transaction: "read_only",
			migrationState: "unadopted",
		});
		const before = await schemaPool.query<{ table_name: string }>(
			"SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()",
		);
		expect(before.rows.some((row) => row.table_name === "__drizzle_migrations")).toBe(false);
		expect(before.rows.some((row) => row.table_name === "LiteLLM_SpendReservations")).toBe(false);

		const first = new Database(databaseConfig(connectionString));
		await first.initialize();
		await first.close();
		await expect(runReadOnlySchemaPreflight(databaseConfig(connectionString))).resolves.toMatchObject({ migrationState: "managed" });

		const second = new Database(databaseConfig(connectionString));
		await second.initialize();
		await second.close();
		const migrations = await schemaPool.query<{ count: string }>('SELECT count(*)::text AS count FROM "__drizzle_migrations"');
		expect(Number(migrations.rows[0]?.count)).toBe(localMigrations.length);
	});

	it("拒绝未知 migration hash", async () => {
		const expected = localMigrations[1]!;
		await schemaPool.query('UPDATE "__drizzle_migrations" SET hash = $1 WHERE created_at = $2', ["unknown", expected.folderMillis]);
		await expect(runReadOnlySchemaPreflight(databaseConfig(connectionString))).rejects.toMatchObject({
			code: "MIGRATION_ARTIFACT_MISMATCH",
		});
		await schemaPool.query('UPDATE "__drizzle_migrations" SET hash = $1 WHERE created_at = $2', [expected.hash, expected.folderMillis]);
	});

	it("拒绝只登记部分 migration", async () => {
		const expected = localMigrations[1]!;
		await schemaPool.query('DELETE FROM "__drizzle_migrations" WHERE created_at = $1', [expected.folderMillis]);
		await expect(runReadOnlySchemaPreflight(databaseConfig(connectionString))).rejects.toMatchObject({
			code: "PARTIAL_MIGRATION_STATE",
		});
		await schemaPool.query('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ($1, $2)', [
			expected.hash,
			expected.folderMillis,
		]);
	});
});
