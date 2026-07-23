import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../db/schema";
import { CallType } from "../types/spend";
import { releaseSpend, renewSpendReservation, reserveSpend, settleSpend, trackSpendLog } from "./SpendTracker";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("Spend reservation PostgreSQL integration", () => {
	let pool: Pool;
	let db: ReturnType<typeof drizzle<typeof schema>>;
	const testSchema = `litellm_spend_test_${process.pid}_${Date.now()}`;

	beforeAll(async () => {
		pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${testSchema}` });
		await pool.query(`CREATE SCHEMA "${testSchema}"`);
		db = drizzle(pool, { schema: schema });
		await db.execute(sql`CREATE TABLE "LiteLLM_BudgetTable" (budget_id text PRIMARY KEY, max_budget double precision)`);
		await db.execute(
			sql`CREATE TABLE "LiteLLM_VerificationToken" (token text PRIMARY KEY, models text[] NOT NULL DEFAULT '{}', max_budget double precision, budget_id text, spend double precision DEFAULT 0, last_active timestamp)`,
		);
		await db.execute(
			sql`CREATE TABLE "LiteLLM_UserTable" (user_id text PRIMARY KEY, max_budget double precision, spend double precision DEFAULT 0)`,
		);
		const migrationSql = readFileSync(resolve(__dirname, "../../drizzle/0001_spend_reservations.sql"), "utf8");
		for (const statement of migrationSql
			.split("--> statement-breakpoint")
			.map((value) => value.trim())
			.filter(Boolean)) {
			await pool.query(statement);
		}
		await db.execute(sql`CREATE TABLE "LiteLLM_SpendLogs" (
			request_id text PRIMARY KEY,
			call_type text NOT NULL,
			api_key text,
			spend double precision,
			total_tokens integer,
			prompt_tokens integer,
			completion_tokens integer,
			"startTime" timestamp NOT NULL,
			"endTime" timestamp NOT NULL,
			request_duration_ms integer,
			"completionStartTime" timestamp,
			model text,
			model_id text,
			model_group text,
			custom_llm_provider text,
			api_base text,
			"user" text,
			metadata jsonb,
			cache_hit text,
			cache_key text,
			request_tags jsonb,
			team_id text,
			organization_id text,
			end_user text,
			requester_ip_address text,
			messages jsonb,
			response jsonb,
			session_id text,
			status text,
			mcp_namespaced_tool_name text,
			agent_id text,
			proxy_server_request jsonb
		)`);
	});

	beforeEach(async () => {
		await db.execute(
			sql`TRUNCATE "LiteLLM_SpendLogs", "LiteLLM_SpendReservations", "LiteLLM_VerificationToken", "LiteLLM_UserTable", "LiteLLM_BudgetTable"`,
		);
		await db.execute(sql`INSERT INTO "LiteLLM_VerificationToken" (token, max_budget, spend) VALUES ('key-a', 10, 0)`);
	});

	afterAll(async () => {
		if (pool) {
			await pool.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
			await pool.end();
		}
	});

	it("并发预留不会超过单主体预算", async () => {
		const results = await Promise.allSettled([
			reserveSpend(db, { requestId: "reserve-a", reserved: 6, scopes: [{ kind: "key", id: "key-a" }] }),
			reserveSpend(db, { requestId: "reserve-b", reserved: 6, scopes: [{ kind: "key", id: "key-a" }] }),
		]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
	});

	it("release 释放余额且可重试", async () => {
		await reserveSpend(db, { requestId: "release-a", reserved: 8, scopes: [{ kind: "key", id: "key-a" }] });
		await expect(releaseSpend(db, "release-a")).resolves.toMatchObject({ status: "released" });
		await expect(releaseSpend(db, "release-a")).resolves.toMatchObject({ status: "released" });
		await expect(
			reserveSpend(db, { requestId: "release-b", reserved: 8, scopes: [{ kind: "key", id: "key-a" }] }),
		).resolves.toMatchObject({ status: "reserved" });
	});

	it("同 request_id 幂等", async () => {
		await reserveSpend(db, { requestId: "idempotent", reserved: 3, scopes: [{ kind: "key", id: "key-a" }] });
		await expect(
			reserveSpend(db, { requestId: "idempotent", reserved: 3, scopes: [{ kind: "key", id: "key-a" }] }),
		).resolves.toMatchObject({ status: "duplicate" });
		await expect(settleSpend(db, "idempotent", 2)).resolves.toMatchObject({ status: "settled", actual: 2 });
		await expect(settleSpend(db, "idempotent", 2)).resolves.toMatchObject({ status: "settled", actual: 2 });
	});

	it("budget_id 使用 BudgetTable 的预算上限", async () => {
		await db.execute(sql`INSERT INTO "LiteLLM_BudgetTable" (budget_id, max_budget) VALUES ('budget-a', 5)`);
		await db.execute(sql`UPDATE "LiteLLM_VerificationToken" SET budget_id = 'budget-a', max_budget = 100 WHERE token = 'key-a'`);

		await expect(reserveSpend(db, { requestId: "budget-id", reserved: 6, scopes: [{ kind: "key", id: "key-a" }] })).rejects.toThrow(
			"预算不足",
		);
	});

	it("过期 reservation 可原子恢复", async () => {
		await reserveSpend(db, { requestId: "expired", reserved: 3, scopes: [{ kind: "key", id: "key-a" }] });
		await db.execute(sql`UPDATE "LiteLLM_SpendReservations" SET expires_at = now() - interval '1 minute' WHERE request_id = 'expired'`);

		await expect(
			reserveSpend(db, { requestId: "expired", reserved: 4, scopes: [{ kind: "key", id: "key-a" }] }),
		).resolves.toMatchObject({ status: "reserved", reserved: 4, actual: null });
		const rows = await db.execute(
			sql`SELECT reserved, status, expires_at > now() AS active FROM "LiteLLM_SpendReservations" WHERE request_id = 'expired'`,
		);
		expect(rows.rows).toEqual([{ reserved: 4, status: "reserved", active: true }]);
	});

	it("已有 SpendLog 时不得创建同 request_id 的 reservation", async () => {
		await db.execute(
			sql`INSERT INTO "LiteLLM_SpendLogs" (request_id, call_type, spend, "startTime", "endTime") VALUES ('historical-only', 'completion', 2.5, now(), now())`,
		);

		await expect(
			reserveSpend(db, { requestId: "historical-only", reserved: 4, scopes: [{ kind: "key", id: "key-a" }] }),
		).resolves.toMatchObject({ status: "duplicate", reserved: 0, actual: 2.5 });
		const rows = await db.execute(sql`SELECT request_id FROM "LiteLLM_SpendReservations" WHERE request_id = 'historical-only'`);
		expect(rows.rows).toHaveLength(0);
	});

	it("历史 SpendLog 阻止恢复同 request_id 的 reservation", async () => {
		await reserveSpend(db, { requestId: "historical", reserved: 3, scopes: [{ kind: "key", id: "key-a" }] });
		await db.execute(
			sql`UPDATE "LiteLLM_SpendReservations" SET expires_at = now() - interval '1 minute' WHERE request_id = 'historical'`,
		);
		await db.execute(
			sql`INSERT INTO "LiteLLM_SpendLogs" (request_id, call_type, spend, "startTime", "endTime") VALUES ('historical', 'completion', 1.25, now(), now())`,
		);

		await expect(
			reserveSpend(db, { requestId: "historical", reserved: 4, scopes: [{ kind: "key", id: "key-a" }] }),
		).resolves.toMatchObject({ status: "duplicate", reserved: 0, actual: 1.25 });
		const rows = await db.execute(
			sql`SELECT reserved, expires_at <= now() AS expired FROM "LiteLLM_SpendReservations" WHERE request_id = 'historical'`,
		);
		expect(rows.rows).toEqual([{ reserved: 3, expired: true }]);
	});

	it("active lease renew 延长租约", async () => {
		await reserveSpend(db, { requestId: "renew", reserved: 2, scopes: [{ kind: "key", id: "key-a" }] });
		await db.execute(sql`UPDATE "LiteLLM_SpendReservations" SET expires_at = now() + interval '1 minute' WHERE request_id = 'renew'`);
		const before = await db.execute(sql`SELECT expires_at FROM "LiteLLM_SpendReservations" WHERE request_id = 'renew'`);

		await expect(renewSpendReservation(db, "renew")).resolves.toMatchObject({ status: "reserved", reserved: 2 });
		const after = await db.execute(sql`SELECT expires_at FROM "LiteLLM_SpendReservations" WHERE request_id = 'renew'`);
		expect(new Date(after.rows[0]?.expires_at as string | Date).getTime()).toBeGreaterThan(
			new Date(before.rows[0]?.expires_at as string | Date).getTime(),
		);
	});

	it("NULL spend 按零参与预算校验", async () => {
		await db.execute(sql`UPDATE "LiteLLM_VerificationToken" SET spend = NULL WHERE token = 'key-a'`);
		await expect(
			reserveSpend(db, { requestId: "null-spend", reserved: 10, scopes: [{ kind: "key", id: "key-a" }] }),
		).resolves.toMatchObject({ status: "reserved", reserved: 10 });
	});

	it("multi-scope 任一预算不足时回滚 ledger", async () => {
		await db.execute(sql`INSERT INTO "LiteLLM_UserTable" (user_id, max_budget, spend) VALUES ('user-a', 1, 0)`);
		await expect(
			reserveSpend(db, {
				requestId: "multi-scope-rollback",
				reserved: 2,
				scopes: [
					{ kind: "key", id: "key-a" },
					{ kind: "user", id: "user-a" },
				],
			}),
		).rejects.toThrow("预算不足");
		const rows = await db.execute(sql`SELECT request_id FROM "LiteLLM_SpendReservations" WHERE request_id = 'multi-scope-rollback'`);
		expect(rows.rows).toHaveLength(0);
	});

	it("预算不足时回滚 ledger 写入", async () => {
		await expect(reserveSpend(db, { requestId: "rollback", reserved: 11, scopes: [{ kind: "key", id: "key-a" }] })).rejects.toThrow(
			"预算不足",
		);
		const rows = await db.execute(sql`SELECT request_id FROM "LiteLLM_SpendReservations" WHERE request_id = 'rollback'`);
		expect(rows.rows).toHaveLength(0);
	});

	it("主体写入失败时回滚 SpendLog 与主体 spend", async () => {
		await db.execute(sql`INSERT INTO "LiteLLM_VerificationToken" (token, max_budget, spend) VALUES ('rollback-key', 10, 1)`);
		await db.execute(sql`CREATE FUNCTION fail_spend_subject_update() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			RAISE EXCEPTION 'forced subject failure';
		END
		$$`);
		await db.execute(sql`CREATE TRIGGER fail_spend_subject_update BEFORE UPDATE ON "LiteLLM_VerificationToken"
		FOR EACH ROW WHEN (OLD.token = 'rollback-key') EXECUTE FUNCTION fail_spend_subject_update()`);

		try {
			await expect(
				trackSpendLog(db, {
					api_key: "rollback-key",
					call_type: CallType.ACompletion,
					completion_tokens: 1,
					custom_cost_per_token: { input_cost_per_token: 0.1, output_cost_per_token: 0.2 },
					endTime: "2026-01-01T00:00:01.000Z",
					model: "integration-model",
					prompt_tokens: 1,
					request_id: "track-rollback",
					spend: 0,
					startTime: "2026-01-01T00:00:00.000Z",
					total_tokens: 2,
				}),
			).rejects.toMatchObject({ name: "ApiError", statusCode: 503 });

			const spendLogs = await db.execute(sql`SELECT request_id FROM "LiteLLM_SpendLogs" WHERE request_id = 'track-rollback'`);
			const subjects = await db.execute(sql`SELECT spend FROM "LiteLLM_VerificationToken" WHERE token = 'rollback-key'`);
			expect(spendLogs.rows).toHaveLength(0);
			expect(subjects.rows).toEqual([{ spend: 1 }]);
		} finally {
			await db.execute(sql`DROP TRIGGER IF EXISTS fail_spend_subject_update ON "LiteLLM_VerificationToken"`);
			await db.execute(sql`DROP FUNCTION IF EXISTS fail_spend_subject_update()`);
		}
	});
});
