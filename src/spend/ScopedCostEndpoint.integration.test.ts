import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../db/schema";
import type { UserAPIKeyAuth } from "../types/auth";
import { registerScopedCostEndpoints } from "./ScopedCostEndpoint";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const COMPANY_A: UserAPIKeyAuth = {
	api_key: "sk-company-a",
	token: "token-company-a",
	user_role: "internal_user",
	user_id: "user-a",
};

const COMPANY_B: UserAPIKeyAuth = {
	api_key: "sk-company-b",
	token: "token-company-b",
	user_role: "internal_user",
	user_id: "user-b",
};

describeWithDatabase("company cost API PostgreSQL integration", () => {
	let pool: Pool;
	let db: ReturnType<typeof drizzle<typeof schema>>;
	const testSchema = `litellm_cost_test_${process.pid}_${Date.now()}`;

	function appFor(auth: UserAPIKeyAuth) {
		const app = express();
		app.use((req, _res, next) => {
			req.auth = auth;
			next();
		});
		registerScopedCostEndpoints(app, db);
		return app;
	}

	beforeAll(async () => {
		pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${testSchema}` });
		await pool.query(`CREATE SCHEMA "${testSchema}"`);
		db = drizzle(pool, { schema });
		await db.execute(sql`CREATE TABLE "LiteLLM_SpendLogs" (
			request_id text PRIMARY KEY,
			api_key text NOT NULL,
			spend double precision NOT NULL DEFAULT 0,
			total_tokens integer NOT NULL DEFAULT 0,
			prompt_tokens integer NOT NULL DEFAULT 0,
			completion_tokens integer NOT NULL DEFAULT 0,
			cache_read_input_tokens bigint NOT NULL DEFAULT 0,
			cache_creation_input_tokens bigint NOT NULL DEFAULT 0,
			"startTime" timestamp NOT NULL,
			"endTime" timestamp NOT NULL,
			request_duration_ms integer,
			call_type text,
			model text,
			model_id text,
			model_group text,
			custom_llm_provider text,
			endpoint text,
			status text,
			key_alias text,
			unit_prices jsonb,
			peak_tier text
		)`);
	});

	beforeEach(async () => {
		await db.execute(sql`TRUNCATE "LiteLLM_SpendLogs"`);
		await db.execute(sql`INSERT INTO "LiteLLM_SpendLogs"
			(request_id, api_key, spend, total_tokens, prompt_tokens, completion_tokens,
			 cache_read_input_tokens, cache_creation_input_tokens, "startTime", "endTime",
			 request_duration_ms, call_type, model, model_id, model_group, custom_llm_provider,
			 endpoint, status, key_alias, unit_prices, peak_tier)
			VALUES
			('req-a', ${COMPANY_A.token}, 1.25, 100, 60, 40, 5, 6, '2026-11-01 10:00:00', '2026-11-01 10:00:01', 1000, 'acompletion', 'standard', 'dep-a', 'standard', 'openai', '/v1/chat/completions', 'success', 'company-a', '{"input":0.000001}', 'peak'),
			('req-b', ${COMPANY_B.token}, 9.99, 900, 500, 400, 0, 0, '2026-11-01 11:00:00', '2026-11-01 11:00:02', 2000, 'acompletion', 'standard', 'dep-b', 'standard', 'openai', '/v1/chat/completions', 'success', 'company-b', '{"input":0.000001}', 'peak')`);
	});

	afterAll(async () => {
		if (pool) {
			await pool.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
			await pool.end();
		}
	});

	it("reads only the calling key's request and never falls through to another company", async () => {
		const own = await request(appFor(COMPANY_A)).get("/spend/cost/request").query({ request_id: "req-a" });
		expect(own.status).toBe(200);
		expect(own.body).toMatchObject({
			request_id: "req-a",
			spend: 1.25,
			total_tokens: 100,
			key_alias: "company-a",
			peak_tier: "peak",
		});
		expect(JSON.stringify(own.body)).not.toContain(COMPANY_A.token);
		expect(JSON.stringify(own.body)).not.toContain("api_key");

		const other = await request(appFor(COMPANY_A)).get("/spend/cost/request").query({ request_id: "req-b" });
		expect(other.status).toBe(404);
		expect(JSON.stringify(other.body)).not.toContain("company-b");
	});

	it("keeps time-window totals inside the calling key's rows", async () => {
		const response = await request(appFor(COMPANY_A))
			.get("/spend/cost/summary")
			.query({ start_date: "2026-11-01", end_date: "2026-11-01" });

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({
			requests: 1,
			total_spend: 1.25,
			total_tokens: 100,
			prompt_tokens: 60,
			completion_tokens: 40,
			cache_read_input_tokens: 5,
			cache_creation_input_tokens: 6,
		});
	});

	it("maps a caller-supplied x-request-id to the stored hash for the same key only", async () => {
		const clientRequestId = "client-request-a";
		const storedId = createHash("sha256").update(COMPANY_A.token!).update("\0").update(clientRequestId).digest("hex");
		await db.execute(sql`INSERT INTO "LiteLLM_SpendLogs"
			(request_id, api_key, spend, "startTime", "endTime", status)
			VALUES (${storedId}, ${COMPANY_A.token}, 0.5, '2026-11-02 10:00:00', '2026-11-02 10:00:01', 'success')`);

		const own = await request(appFor(COMPANY_A)).get("/spend/cost/request").query({ client_request_id: clientRequestId });
		expect(own.status).toBe(200);
		expect(own.body.request_id).toBe(storedId);

		const other = await request(appFor(COMPANY_B)).get("/spend/cost/request").query({ client_request_id: clientRequestId });
		expect(other.status).toBe(404);
	});
});
