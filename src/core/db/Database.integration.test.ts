import { Pool } from "pg";
import { Database } from "./Database";
import type { DatabaseConfig } from "../config";

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

describeWithDatabase("Database PostgreSQL takeover integration", () => {
	const schemaName = `litellm_takeover_${process.pid}_${Date.now()}`;
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
