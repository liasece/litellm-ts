import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { UserAPIKeyAuth } from "../types/auth";
import { registerScopedCostEndpoints } from "./ScopedCostEndpoint";
import { createApiKeyAuth, webUiCsrfProtection } from "../auth/UserApiKeyAuth";
import { AuthorizationGuard } from "../auth/AuthorizationGuard";
import type { AuthRepository } from "../auth/AuthRepository";
import { PROXY_ADMIN_ROLE } from "../types/webUiSession";
import { hashApiKey } from "../core/utils/crypto";
import { errorHandler } from "../middleware/ErrorHandler";

const COMPANY_AUTH: UserAPIKeyAuth = {
	api_key: "sk-company-a-plaintext",
	token: "company-a-token-hash",
	user_role: "internal_user",
	user_id: "user-a",
	team_id: "team-a",
	key_alias: "company-a",
};

interface CapturedQuery {
	readonly projection: ReadonlyArray<string>;
	readonly predicate: SQL;
	readonly limit: number | null;
}

/**
 * 只实现端点实际用到的 select().from().where()[:.limit()] 链。
 * `where()` 返回 thenable，既支持直接 await（汇总），也支持 `.limit(1)`（单条）。
 */
function makeDb(rows: unknown[] = []) {
	const captured: CapturedQuery[] = [];
	const select = jest.fn((projection: Record<string, unknown>) => {
		const projectionKeys = Object.keys(projection);
		const from = jest.fn(() => ({
			where: (predicate: SQL) => {
				const entry: CapturedQuery = { projection: projectionKeys, predicate: predicate, limit: null };
				captured.push(entry);
				const limited = {
					limit: async (limit: number) => {
						(entry as { limit: number | null }).limit = limit;
						return rows;
					},
					then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
						Promise.resolve(rows).then(resolve, reject),
				};
				return limited;
			},
		}));
		return { from };
	});
	return { db: { select } as never, captured, select };
}

function fixture(rows: unknown[] = []) {
	const { db, captured, select } = makeDb(rows);
	const app = express();
	app.use((req, _res, next) => {
		req.auth = COMPANY_AUTH;
		next();
	});
	registerScopedCostEndpoints(app, db);
	return { app, captured, select };
}

function paramsOf(query: CapturedQuery): unknown[] {
	return new PgDialect().sqlToQuery(query.predicate).params;
}

describe("GET /spend/cost/request", () => {
	it("returns only the caller's settled request cost without key or payload fields", async () => {
		const { app, captured } = fixture([
			{
				request_id: "req-1",
				spend: 0.0123,
				total_tokens: 100,
				prompt_tokens: 60,
				completion_tokens: 40,
				cache_read_input_tokens: 5,
				cache_creation_input_tokens: 6,
				startTime: new Date("2026-11-20T10:00:00.000Z"),
				endTime: new Date("2026-11-20T10:00:01.500Z"),
				request_duration_ms: 1500,
				call_type: "acompletion",
				model: "standard",
				model_id: "deployment-1",
				model_group: "standard",
				custom_llm_provider: "openai",
				endpoint: "/v1/chat/completions",
				status: "success",
				key_alias: "company-a",
				unit_prices: { input: 0.000001, output: 0.000002 },
				peak_tier: "peak",
			},
		]);

		const response = await request(app).get("/spend/cost/request").query({ request_id: "req-1" });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({
			object: "spend.cost.request",
			currency: "USD",
			scope: "key",
			request_id: "req-1",
			spend: 0.0123,
			total_tokens: 100,
			prompt_tokens: 60,
			completion_tokens: 40,
			cache_read_input_tokens: 5,
			cache_creation_input_tokens: 6,
			start_time: "2026-11-20T10:00:00.000Z",
			end_time: "2026-11-20T10:00:01.500Z",
			request_duration_ms: 1500,
			call_type: "acompletion",
			model: "standard",
			model_id: "deployment-1",
			model_group: "standard",
			custom_llm_provider: "openai",
			endpoint: "/v1/chat/completions",
			status: "success",
			key_alias: "company-a",
			unit_prices: { input: 0.000001, output: 0.000002 },
			peak_tier: "peak",
		});
		const payload = paramsOf(captured[0]!);
		expect(payload).toContain("req-1");
		expect(payload).toContain("company-a-token-hash");
		expect(captured[0]!.limit).toBe(1);
		expect(JSON.stringify(response.body)).not.toContain(COMPANY_AUTH.api_key);
		expect(JSON.stringify(response.body)).not.toContain("api_key");
		expect(JSON.stringify(response.body)).not.toContain("metadata");
		expect(JSON.stringify(response.body)).not.toContain("messages");
	});

	it("hashes the caller-supplied x-request-id namespace instead of accepting another key's stored id", async () => {
		const clientRequestId = "client-request-1";
		const expected = createHash("sha256").update(COMPANY_AUTH.token!).update("\0").update(clientRequestId).digest("hex");
		const { app, captured } = fixture([{ request_id: expected, spend: 0.5 }]);

		const response = await request(app).get("/spend/cost/request").query({ client_request_id: clientRequestId });

		expect(response.status).toBe(200);
		expect(captured[0]!.projection).toContain("request_id");
		const payload = paramsOf(captured[0]!);
		expect(payload).toContain(expected);
		expect(payload).toContain("company-a-token-hash");
		expect(payload).not.toContain("sk-company-a-plaintext");
	});

	it("returns 404 for a request that the caller's key did not make", async () => {
		const { app, captured } = fixture([]);
		const response = await request(app).get("/spend/cost/request").query({ request_id: "someone-elses-request" });

		expect(response.status).toBe(404);
		expect(response.body.error).toMatchObject({ code: "404", type: "not_found" });
		expect(paramsOf(captured[0]!)).toContain("company-a-token-hash");
	});

	it("rejects ambiguous, missing and oversized identifiers before querying", async () => {
		const { app, select } = fixture();

		expect((await request(app).get("/spend/cost/request")).status).toBe(400);
		expect((await request(app).get("/spend/cost/request").query({ request_id: "r", client_request_id: "c" })).status).toBe(400);
		expect(
			(
				await request(app)
					.get("/spend/cost/request")
					.query({ request_id: "x".repeat(513) })
			).status,
		).toBe(400);
		expect(
			(
				await request(app)
					.get("/spend/cost/request")
					.query({ client_request_id: "x".repeat(513) })
			).status,
		).toBe(400);
		expect(select).not.toHaveBeenCalled();
	});
});

describe("GET /spend/cost/summary", () => {
	it("sums only the caller's key over an inclusive UTC date window", async () => {
		const { app, captured } = fixture([
			{
				total_spend: 1.25,
				total_tokens: 1000,
				prompt_tokens: 600,
				completion_tokens: 400,
				cache_read_input_tokens: 10,
				cache_creation_input_tokens: 20,
				requests: 3,
				first_start: new Date("2026-11-01T00:00:00.000Z"),
				last_end: new Date("2026-11-02T23:59:00.000Z"),
			},
		]);

		const response = await request(app).get("/spend/cost/summary").query({ start_date: "2026-11-01", end_date: "2026-11-02" });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({
			object: "spend.cost.summary",
			currency: "USD",
			scope: "key",
			start_date: "2026-11-01",
			end_date: "2026-11-02",
			model: null,
			requests: 3,
			total_spend: 1.25,
			total_tokens: 1000,
			prompt_tokens: 600,
			completion_tokens: 400,
			cache_read_input_tokens: 10,
			cache_creation_input_tokens: 20,
			first_request_at: "2026-11-01T00:00:00.000Z",
			last_request_at: "2026-11-02T23:59:00.000Z",
		});
		const payload = paramsOf(captured[0]!);
		expect(payload).toContain("company-a-token-hash");
		expect(payload).toContain("2026-11-01T00:00:00.000Z");
		expect(payload).toContain("2026-11-03T00:00:00.000Z");
	});

	it("supports a model filter and keeps it in the key-scoped SQL", async () => {
		const { app, captured } = fixture([{ total_spend: 0, total_tokens: 0, requests: 0 }]);

		const response = await request(app)
			.get("/spend/cost/summary")
			.query({ start_date: "2026-11-01", end_date: "2026-11-02", model: "standard" });

		expect(response.status).toBe(200);
		expect(response.body.model).toBe("standard");
		const payload = paramsOf(captured[0]!);
		expect(payload).toContain("standard");
		expect(payload).toContain("company-a-token-hash");
	});

	it("requires an explicit bounded window and rejects malformed dates", async () => {
		const { app, select } = fixture();

		expect((await request(app).get("/spend/cost/summary")).status).toBe(400);
		expect((await request(app).get("/spend/cost/summary").query({ start_date: "2026-11-01" })).status).toBe(400);
		expect((await request(app).get("/spend/cost/summary").query({ start_date: "2026-02-30", end_date: "2026-03-01" })).status).toBe(
			400,
		);
		expect((await request(app).get("/spend/cost/summary").query({ start_date: "2020-01-01", end_date: "2026-11-01" })).status).toBe(
			400,
		);
		expect(select).not.toHaveBeenCalled();
	});
});

it("requires authentication context", async () => {
	const app = express();
	registerScopedCostEndpoints(app, { select: jest.fn() } as never);
	expect((await request(app).get("/spend/cost/request").query({ request_id: "req-1" })).status).toBe(401);
	expect((await request(app).get("/spend/cost/summary")).status).toBe(401);
});

/**
 * 真实认证链回归：`createApiKeyAuth` → `webUiCsrfProtection` → `authorizationGuard("spend")`。
 *
 * 生产 cc-server key 的 user_role 是 `proxy_admin`（挂在 `default_user_id` 下），但
 * `allowed_routes` 只有 `{llm_api_routes, spend_read_routes}`。端点若用
 * `resolveUsageScope(auth, "key")` 求范围，proxy_admin 不传 key 参数会得到
 * "不限 key" 的 `undefined`，随后被当作未认证 → 401 `Authentication required`。
 * 这个用例走完整鉴权链，断言同一把 key 既能通过 spend 白名单读到自己的汇总，又仍被
 * 白名单挡在 `/spend/logs` 之外。
 */
describe("真实认证链：proxy_admin 角色的公司 key", () => {
	const CC_SERVER_KEY = "sk-cc-server-real-chain";
	const CC_SERVER_TOKEN = hashApiKey(CC_SERVER_KEY);

	function makeTokenRow(allowedRoutes: readonly string[] | null) {
		return {
			token: CC_SERVER_TOKEN,
			userId: "default_user_id",
			teamId: null,
			organizationId: null,
			projectId: null,
			keyAlias: "cc-server",
			models: [],
			spend: 0,
			maxBudget: null,
			tpmLimit: null,
			rpmLimit: null,
			metadata: null,
			blocked: false,
			permissions: null,
			budgetResetAt: null,
			expires: null,
			keyName: null,
			allowedRoutes: allowedRoutes,
			modelSpend: null,
			modelMaxBudget: null,
			budgetId: null,
			lastActive: null,
			maxParallelRequests: null,
		};
	}

	function makeApp(rows: unknown[], allowedRoutes: readonly string[] | null) {
		const repository = {
			findVerificationTokenByHash: async (tokenHash: string) => (tokenHash === CC_SERVER_TOKEN ? makeTokenRow(allowedRoutes) : null),
			findUserById: async () => ({ userId: "default_user_id", userRole: PROXY_ADMIN_ROLE, spend: 0, maxBudget: null }),
		};
		const { db, captured } = makeDb(rows);
		const app = express();
		const router = express.Router();
		router.use(createApiKeyAuth(repository as unknown as AuthRepository));
		router.use(webUiCsrfProtection);
		router.use(new AuthorizationGuard(repository as unknown as AuthRepository).middleware("spend"));
		registerScopedCostEndpoints(router, db);
		app.use(router);
		app.use(errorHandler);
		return { app, captured };
	}

	const COMPANY_KEY_ROUTES = ["llm_api_routes", "spend_read_routes"];

	it("serves the calling key's own summary even though the key's user is proxy_admin", async () => {
		const { app, captured } = makeApp([{ requests: 4500, total_spend: 12.5, total_tokens: 900000 }], COMPANY_KEY_ROUTES);

		const response = await request(app)
			.get("/spend/cost/summary")
			.set("Authorization", `Bearer ${CC_SERVER_KEY}`)
			.query({ start_date: "2026-11-21", end_date: "2026-11-22" });

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ object: "spend.cost.summary", scope: "key", requests: 4500, total_spend: 12.5 });
		// 范围仍然是这把 key 自己：SQL 用 token 哈希过滤，而不是管理员语义的「不限 key」。
		const payload = paramsOf(captured[0]!);
		expect(payload).toContain(CC_SERVER_TOKEN);
		expect(payload).not.toContain(CC_SERVER_KEY);
	});

	it("serves the calling key's own request cost through the same chain", async () => {
		const { app, captured } = makeApp([{ request_id: "req-cc-1", spend: 0.5, key_alias: "cc-server" }], COMPANY_KEY_ROUTES);

		const response = await request(app)
			.get("/spend/cost/request")
			.set("Authorization", `Bearer ${CC_SERVER_KEY}`)
			.query({ request_id: "req-cc-1" });

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ request_id: "req-cc-1", spend: 0.5, scope: "key" });
		expect(paramsOf(captured[0]!)).toContain(CC_SERVER_TOKEN);
	});

	it("keeps spend_read_routes from opening the dashboard log routes", async () => {
		const { app } = makeApp([], COMPANY_KEY_ROUTES);

		const response = await request(app)
			.get("/spend/logs")
			.set("Authorization", `Bearer ${CC_SERVER_KEY}`)
			.query({ start_date: "2026-11-21" });

		expect(response.status).toBe(403);
		expect(response.body.error).toMatchObject({ code: "403" });
	});

	it("rejects the same key when spend_read_routes is missing from its allowlist", async () => {
		const { app } = makeApp([], ["llm_api_routes"]);

		const response = await request(app)
			.get("/spend/cost/summary")
			.set("Authorization", `Bearer ${CC_SERVER_KEY}`)
			.query({ start_date: "2026-11-21", end_date: "2026-11-22" });

		expect(response.status).toBe(403);
	});
});
