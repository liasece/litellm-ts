import pg from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Database, runReadOnlySchemaPreflight } from "./Database";
import { runSchemaPreflight } from "./SchemaPreflight";

const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();
const mockPoolQuery = jest.fn();
const mockPoolEnd = jest.fn();
const mockPoolConnect = jest.fn().mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });

jest.mock("pg", () => ({
	__esModule: true,
	default: {
		Pool: jest.fn().mockImplementation(() => ({ connect: mockPoolConnect, query: mockPoolQuery, end: mockPoolEnd })),
	},
}));

jest.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate: jest.fn() }));
jest.mock("./SchemaPreflight", () => ({ runSchemaPreflight: jest.fn() }));

const config = {
	host: "db.internal",
	port: 5432,
	database: "litellm",
	user: "encoded%40user",
	password: "p%2Fass",
	connectionString:
		"postgresql://encoded%40user:p%2Fass@db.internal/litellm?sslmode=require&schema=tenant_a&connect_timeout=12&options=-c%20statement_timeout%3D5000",
	maxConnections: 17,
};

function sqlText(value: unknown): string {
	return typeof value === "string" ? value : ((value as { text?: string }).text ?? "");
}

describe("Database initialization takeover", () => {
	let tableCount = 0;

	beforeEach(() => {
		jest.clearAllMocks();
		tableCount = 0;
		jest.mocked(migrate).mockResolvedValue(undefined);
		jest.mocked(runSchemaPreflight).mockResolvedValue(undefined);
		mockClientQuery.mockImplementation((query: unknown) => {
			const text = sqlText(query);
			if (text.includes("current_schema() AS schema_name")) {
				return Promise.resolve({ rows: [{ schema_name: "tenant_a" }] });
			}
			if (text.includes("count(*)") && text.includes("LiteLLM")) {
				return Promise.resolve({ rows: [{ table_count: String(tableCount) }] });
			}
			if (text.includes("select id, hash, created_at")) {
				return Promise.resolve({ rows: [] });
			}
			return Promise.resolve({ rows: [] });
		});
		mockPoolQuery.mockResolvedValue({ rows: [{ "?column?": 1 }] });
	});

	it("保留连接串、pool limit、timeout、schema/search_path 与编码凭据", () => {
		new Database(config);
		expect(pg.Pool).toHaveBeenCalledWith(
			expect.objectContaining({
				connectionString: config.connectionString,
				max: 17,
				connectionTimeoutMillis: 12_000,
				options: expect.stringContaining("statement_timeout=5000"),
			}),
		);
		expect(jest.mocked(pg.Pool).mock.calls[0]?.[0]?.options).toContain("search_path=tenant_a");
		expect(JSON.stringify(jest.mocked(pg.Pool).mock.calls[0]?.[0])).not.toContain("p/ass");
	});

	it("空库直接 bootstrap，迁移后执行只读 preflight", async () => {
		const database = new Database(config);
		await database.initialize();
		expect(runSchemaPreflight).toHaveBeenCalledTimes(1);
		expect(migrate).toHaveBeenCalledTimes(1);
		expect(mockClientQuery.mock.calls.some(([query]) => sqlText(query).includes('INSERT INTO "tenant_a"."__drizzle_migrations"'))).toBe(
			false,
		);
	});

	it("既有 Python LiteLLM DB 先 preflight，再登记 adoption baseline 并迁移", async () => {
		tableCount = 1;
		const database = new Database(config);
		await database.initialize();
		expect(runSchemaPreflight).toHaveBeenCalledTimes(2);
		const preflightOrder = jest.mocked(runSchemaPreflight).mock.invocationCallOrder[0]!;
		const migrateOrder = jest.mocked(migrate).mock.invocationCallOrder[0]!;
		expect(preflightOrder).toBeLessThan(migrateOrder);
		expect(mockClientQuery.mock.calls.some(([query]) => sqlText(query).includes('INSERT INTO "tenant_a"."__drizzle_migrations"'))).toBe(
			true,
		);
	});

	it("连接、preflight 和 migration 均受同一个 advisory lock 保护并最终释放", async () => {
		tableCount = 1;
		const database = new Database(config);
		await database.initialize();
		const calls = mockClientQuery.mock.calls.map(([query]) => sqlText(query));
		const lock = calls.findIndex((text) => text.includes("pg_advisory_lock"));
		const detect = calls.findIndex((text) => text.includes("count(*)") && text.includes("LiteLLM"));
		const unlock = calls.findIndex((text) => text.includes("pg_advisory_unlock"));
		expect(lock).toBeGreaterThanOrEqual(0);
		expect(detect).toBeGreaterThan(lock);
		expect(unlock).toBeGreaterThan(detect);
		expect(mockClientRelease).toHaveBeenCalledTimes(1);
	});

	it("drift 或 migration 失败时 readiness 保持失败", async () => {
		tableCount = 1;
		jest.mocked(runSchemaPreflight).mockRejectedValueOnce(new Error("schema drift"));
		const drifted = new Database(config);
		await expect(drifted.initialize()).rejects.toThrow("schema drift");
		await expect(drifted.probeReadiness()).resolves.toEqual({ ready: false, reason: "not_initialized" });

		jest.mocked(runSchemaPreflight).mockResolvedValue(undefined);
		jest.mocked(migrate).mockRejectedValueOnce(new Error("migration failed"));
		const migrationFailed = new Database(config);
		await expect(migrationFailed.initialize()).rejects.toThrow("migration failed");
		await expect(migrationFailed.probeReadiness()).resolves.toEqual({ ready: false, reason: "not_initialized" });
	});
});

describe("runReadOnlySchemaPreflight", () => {
	const localMigrations = readMigrationFiles({ migrationsFolder: `${process.cwd()}/drizzle` });

	beforeEach(() => {
		jest.clearAllMocks();
		jest.mocked(runSchemaPreflight).mockResolvedValue(undefined);
		mockClientQuery.mockImplementation((query: unknown) => {
			const text = sqlText(query);
			if (text.includes("current_database() AS database_name")) {
				return Promise.resolve({ rows: [{ database_name: "litellm", schema_name: "tenant_a" }] });
			}
			if (text.includes("to_regclass")) {
				return Promise.resolve({ rows: [{ exists: true }] });
			}
			if (text.includes("SELECT hash, created_at")) {
				return Promise.resolve({
					rows: localMigrations.map((migration) => ({ hash: migration.hash, created_at: String(migration.folderMillis) })),
				});
			}
			return Promise.resolve({ rows: [] });
		});
		mockPoolEnd.mockResolvedValue(undefined);
	});

	it("仅在只读事务中执行 schema 与完整 migration 检查后提交", async () => {
		await expect(runReadOnlySchemaPreflight(config)).resolves.toEqual({
			status: "ok",
			check: "production_database",
			transaction: "read_only",
			schema: "tenant_a",
			migrationState: "managed",
		});
		const calls = mockClientQuery.mock.calls.map(([query]) => sqlText(query));
		expect(calls[0]).toBe("BEGIN READ ONLY");
		expect(calls).toContain("COMMIT");
		expect(runSchemaPreflight).toHaveBeenCalledTimes(1);
		expect(mockClientRelease).toHaveBeenCalledTimes(1);
		expect(mockPoolEnd).toHaveBeenCalledTimes(1);
		expect(calls.join("\n")).not.toMatch(/pg_advisory|\b(?:INSERT|CREATE|ALTER|DROP|UPDATE|DELETE)\b/i);
		expect(migrate).not.toHaveBeenCalled();
	});

	it("未 adoption 的 Python baseline 允许通过且不创建 migration 表", async () => {
		mockClientQuery.mockImplementation((query: unknown) => {
			const text = sqlText(query);
			if (text.includes("current_database() AS database_name")) {
				return Promise.resolve({ rows: [{ database_name: "litellm", schema_name: "tenant_a" }] });
			}
			if (text.includes("to_regclass")) {
				return Promise.resolve({ rows: [{ exists: false }] });
			}
			return Promise.resolve({ rows: [] });
		});
		await expect(runReadOnlySchemaPreflight(config)).resolves.toMatchObject({ migrationState: "unadopted" });
		expect(mockClientQuery.mock.calls.map(([query]) => sqlText(query)).join("\n")).not.toMatch(/\bCREATE\b/i);
	});

	it("未知或部分 migration 失败时 rollback 并清理连接", async () => {
		mockClientQuery.mockImplementation((query: unknown) => {
			const text = sqlText(query);
			if (text.includes("current_database() AS database_name")) {
				return Promise.resolve({ rows: [{ database_name: "litellm", schema_name: "tenant_a" }] });
			}
			if (text.includes("to_regclass")) {
				return Promise.resolve({ rows: [{ exists: true }] });
			}
			if (text.includes("SELECT hash, created_at")) {
				return Promise.resolve({ rows: [{ hash: "unknown", created_at: "1" }] });
			}
			return Promise.resolve({ rows: [] });
		});
		await expect(runReadOnlySchemaPreflight(config)).rejects.toMatchObject({ code: "UNKNOWN_MIGRATION" });
		expect(mockClientQuery.mock.calls.map(([query]) => sqlText(query))).toContain("ROLLBACK");
		expect(mockClientRelease).toHaveBeenCalledTimes(1);
		expect(mockPoolEnd).toHaveBeenCalledTimes(1);
	});

	it("schema preflight 失败时 rollback 且不泄露原始错误", async () => {
		jest.mocked(runSchemaPreflight).mockRejectedValueOnce(new Error("password=secret host=db.internal"));
		await expect(runReadOnlySchemaPreflight(config)).rejects.toMatchObject({
			stage: "schema",
			code: "PREFLIGHT_FAILED",
			message: "PostgreSQL read-only preflight failed",
		});
		expect(mockClientQuery.mock.calls.map(([query]) => sqlText(query))).toContain("ROLLBACK");
		expect(mockClientRelease).toHaveBeenCalledTimes(1);
		expect(mockPoolEnd).toHaveBeenCalledTimes(1);
	});
});
