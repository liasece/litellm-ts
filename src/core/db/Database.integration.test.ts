import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "node:os";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolve } from "path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Pool } from "pg";
import type { DatabaseConfig } from "../config";
import { DatabaseVisionImageStore } from "../../capabilities/VisionImageStore";
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
		expect(tables.rows.some((row) => row.table_name === "LiteLLM_BuiltinCapabilityImages")).toBe(true);
		const migrations = await schemaPool.query<{ count: string }>('SELECT count(*)::text AS count FROM "__drizzle_migrations"');
		expect(Number(migrations.rows[0]?.count)).toBe(
			readMigrationFiles({ migrationsFolder: resolve(__dirname, "../../../drizzle") }).length,
		);

		const second = new Database(databaseConfig(connectionString));
		await second.initialize();
		await expect(second.probeReadiness()).resolves.toEqual({ ready: true });
		await second.close();
	});

	it("content-addressed built-in images deduplicate and can be loaded by hash reference", async () => {
		const database = new Database(databaseConfig(connectionString));
		await database.initialize();
		const store = new DatabaseVisionImageStore(database.db);
		const first = await store.put({ mediaType: "image/png", base64Data: Buffer.from("same-image").toString("base64") });
		const second = await store.put({ mediaType: "image/png", base64Data: Buffer.from("same-image").toString("base64") });
		expect(second.ref).toBe(first.ref);
		await expect(store.get(first.ref)).resolves.toEqual(first);
		const rows = await schemaPool.query<{ count: string }>(
			'SELECT count(*)::text AS count FROM "LiteLLM_BuiltinCapabilityImages" WHERE "content_hash" = $1',
			[first.contentHash],
		);
		expect(Number(rows.rows[0]?.count)).toBe(1);
		await database.close();
	});

	it("session group function 优先识别 user_id JSON 内的稳定 session_id", async () => {
		const database = new Database(databaseConfig(connectionString));
		await database.initialize();
		await database.close();
		const embeddedSessionId = "63c6d8fc-3ca5-4f54-8cd9-aae8ca57dad9";
		const metadata = {
			spend_logs_metadata: {
				user_id: JSON.stringify({
					device_id: "device-1",
					account_uuid: "",
					session_id: embeddedSessionId,
				}),
			},
		};
		const result = await schemaPool.query<{ session_group_key: string }>(
			"SELECT litellm_session_group_key($1::jsonb, $2::text, $3::text) AS session_group_key",
			[JSON.stringify(metadata), "68d79373-9498-474b-8c42-593aa982d6fd", "req-1"],
		);
		expect(result.rows[0]?.session_group_key).toBe(`s:${embeddedSessionId}`);
	});

	it("session group function 优先使用服务端提取的 Codex 任务分组键", async () => {
		const database = new Database(databaseConfig(connectionString));
		await database.initialize();
		await database.close();
		const threadId = "019fa826-205c-7350-9e17-7e76ce77ce43";
		const result = await schemaPool.query<{ session_group_key: string }>(
			"SELECT litellm_session_group_key($1::jsonb, $2::text, $3::text) AS session_group_key",
			[JSON.stringify({ session_group_key: `s:${threadId}` }), "781f34ac-e9b5-4e07-b55a-ecebae9b2668", "req-1"],
		);
		expect(result.rows[0]?.session_group_key).toBe(`s:${threadId}`);
	});

	it("带前缀的客户端会话 ID 归一成裸 UUID 分组键，与其他写法合并到同一会话", async () => {
		const database = new Database(databaseConfig(connectionString));
		await database.initialize();
		await database.close();
		const sessionId = "2e24587f-15e6-4d81-b63d-f5e53668efb3";
		const groupKeyFor = async (canonical: string): Promise<string | undefined> => {
			const result = await schemaPool.query<{ session_group_key: string }>(
				"SELECT litellm_session_group_key($1::jsonb, $2::text, $3::text) AS session_group_key",
				[JSON.stringify({ session_group_key: canonical }), "request-level-uuid", "req-1"],
			);
			return result.rows[0]?.session_group_key;
		};
		// 客户端可能写 session-<uuid>、SESSION-<uuid> 或裸 UUID；三者必须落到同一会话，
		// 否则一次对话会在 Logs 里被拆成多个会话。
		await expect(groupKeyFor(`s:session-${sessionId}`)).resolves.toBe(`s:${sessionId}`);
		await expect(groupKeyFor(`s:${sessionId.toUpperCase()}`)).resolves.toBe(`s:${sessionId}`);
		await expect(groupKeyFor(`s:${sessionId}`)).resolves.toBe(`s:${sessionId}`);
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

	it("允许数据库落后于本地最新 migration，供停机部署预检后执行迁移", async () => {
		const expected = localMigrations.at(-1)!;
		await schemaPool.query('DELETE FROM "__drizzle_migrations" WHERE created_at = $1', [expected.folderMillis]);
		await expect(runReadOnlySchemaPreflight(databaseConfig(connectionString))).resolves.toMatchObject({
			migrationState: "managed",
		});
		await schemaPool.query('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ($1, $2)', [
			expected.hash,
			expected.folderMillis,
		]);
	});
});

describeWithDatabase("从真实的旧会话分组 schema 升级", () => {
	const schemaName = `litellm_before_session_group_${process.pid}_${Date.now()}`;
	let schemaPool: Pool;
	let connectionString: string;

	beforeAll(async () => {
		schemaPool = new Pool({ connectionString: testDatabaseUrl, options: `-c search_path=${schemaName}` });
		await schemaPool.query(`CREATE SCHEMA "${schemaName}"`);
		const parsed = new URL(testDatabaseUrl!);
		parsed.searchParams.set("schema", schemaName);
		connectionString = parsed.toString();
		// Run the real migration chain up to the predecessor of the session grouping upgrade.
		// Removing just the latest journal row from a current schema cannot reproduce an old database.
		const source = resolve(__dirname, "../../../drizzle");
		const journal = JSON.parse(readFileSync(resolve(source, "meta/_journal.json"), "utf8")) as {
			entries: Array<{ idx: number; tag: string }>;
		};
		const target = journal.entries.find((entry) => entry.tag === "0009_session_group_prefixed_ids")!;
		const entries = journal.entries.filter((entry) => entry.idx < target.idx);
		const temporary = mkdtempSync(resolve(tmpdir(), "litellm-historical-migrations-"));
		try {
			mkdirSync(resolve(temporary, "meta"));
			writeFileSync(resolve(temporary, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
			for (const entry of entries) {
				const name = `${entry.tag}.sql`;
				copyFileSync(resolve(source, name), resolve(temporary, name));
			}
			await migrate(drizzle(schemaPool), { migrationsFolder: temporary, migrationsSchema: schemaName });
		} finally {
			rmSync(temporary, { recursive: true, force: true });
		}
	});

	afterAll(async () => {
		if (schemaPool) {
			await schemaPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
			await schemaPool.end();
		}
	});

	it("启动迁移不改写历史日志；显式回填分批合并会话并可重试", async () => {
		const sessionUuid = "2e24587f-15e6-4d81-b63d-f5e53668efb3";
		const requestBody = {
			body: { prompt_cache_key: `session-${sessionUuid}` },
			headers: { session_id: `session-${sessionUuid}` },
		};
		await schemaPool.query(
			`INSERT INTO "LiteLLM_SpendLogs" (request_id, call_type, api_key, model, "startTime", "endTime", session_id, metadata, proxy_server_request)
			 VALUES ('backfill-1', 'aresponses', 'k', 'm', now(), now(), 'request-level-1', '{}'::jsonb, $1::jsonb),
			        ('backfill-2', 'aresponses', 'k', 'm', now(), now(), 'request-level-2', '{}'::jsonb, $1::jsonb)`,
			[JSON.stringify(requestBody)],
		);
		await schemaPool.query(
			`INSERT INTO "LiteLLM_SpendLogs" (request_id, call_type, api_key, model, "startTime", "endTime", session_id, metadata, proxy_server_request)
			 VALUES ('backfill-0', 'aresponses', 'k', 'm', now(), now(), 'request-level-0', '{}'::jsonb, '{}'::jsonb)`,
		);
		const upgraded = new Database(databaseConfig(connectionString));
		try {
			await upgraded.initialize();
			await expect(upgraded.probeReadiness()).resolves.toEqual({ ready: true });
		} finally {
			await upgraded.close();
		}
		// 升级只更新规则，不扫描请求或改写现有分组；历史回填由独立维护入口完成。
		const before = await schemaPool.query<{ session_group_key: string }>(
			`SELECT session_group_key FROM "LiteLLM_SpendLogs" WHERE request_id LIKE 'backfill-%' ORDER BY request_id`,
		);
		expect(before.rows.map((row) => row.session_group_key)).toEqual(["s:request-level-0", "s:request-level-1", "s:request-level-2"]);

		const maintenanceSql = readFileSync(resolve(__dirname, "../../../scripts/backfill-session-group-ids.sql"), "utf8");
		const backfillSql = maintenanceSql
			.slice(maintenanceSql.indexOf("WITH batch"), maintenanceSql.lastIndexOf("COMMIT;"))
			.replace(":'after_request_id'", "$1")
			.replace(":batch_size", "$2");
		const firstBatch = await schemaPool.query(backfillSql, ["", 1]);
		expect(firstBatch.rows[0]).toMatchObject({ scanned_rows: "1", updated_rows: "0" });
		const secondBatch = await schemaPool.query(backfillSql, [firstBatch.rows[0].next_request_id, 1]);
		expect(secondBatch.rows[0]).toMatchObject({ scanned_rows: "1", updated_rows: "1" });
		const thirdBatch = await schemaPool.query(backfillSql, [secondBatch.rows[0].next_request_id, 1]);
		expect(thirdBatch.rows[0]).toMatchObject({ scanned_rows: "1", updated_rows: "1" });
		const exhausted = await schemaPool.query(backfillSql, [thirdBatch.rows[0].next_request_id, 1]);
		expect(exhausted.rows[0]).toMatchObject({ scanned_rows: "0", updated_rows: "0" });

		// 修复后：两行合并成同一个会话，且再跑一次不会改变结果。
		const after = await schemaPool.query<{ session_group_key: string }>(
			`SELECT session_group_key FROM "LiteLLM_SpendLogs" WHERE request_id LIKE 'backfill-%' ORDER BY request_id`,
		);
		expect(after.rows.map((row) => row.session_group_key)).toEqual(["s:request-level-0", `s:${sessionUuid}`, `s:${sessionUuid}`]);
		const repeated = await schemaPool.query(backfillSql, ["", 3]);
		expect(repeated.rows[0]).toMatchObject({ scanned_rows: "3", updated_rows: "0" });
		const rerun = await schemaPool.query<{ session_group_key: string }>(
			`SELECT session_group_key FROM "LiteLLM_SpendLogs" WHERE request_id LIKE 'backfill-%' ORDER BY request_id`,
		);
		expect(rerun.rows.map((row) => row.session_group_key)).toEqual(["s:request-level-0", `s:${sessionUuid}`, `s:${sessionUuid}`]);
	});
});
