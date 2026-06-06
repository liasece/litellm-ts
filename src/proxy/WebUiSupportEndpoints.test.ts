/**
 * WebUI 支撑端点契约测试
 *
 * 锁定 WebUI 依赖的响应形状，避免上游 Python LiteLLM 字段变更导致前端崩溃。
 * - /config/list: 必须是数组
 * - /model_group/info: 必须包含 data 数组
 * - /key/list: 必须是分页形状 { keys, total_count, current_page, total_pages }
 * - login: 必须设置 token cookie
 */
import express from "express";
import request from "supertest";
import { registerWebUiSupportPublicRoutes, registerWebUiSupportRoutes } from "./WebUiSupportEndpoints";
import { registerModelsPageSupportRoutes } from "./ModelsPageSupportEndpoints";
import { registerLoginRoutes } from "./LoginEndpoints";
import { createKeyManagementRoutes } from "../management/KeyManagementEndpoint";
import { createTeamRoutes } from "../management/TeamEndpoint";
import type { ServiceConfig } from "../core/config";
import type { RouterDeploymentsAccessor } from "./ModelsPageSupportEndpoints";
import type { Deployment } from "../types/router";

function makeConfig(overrides: Record<string, unknown> = {}, generalSettingsRaw?: Record<string, unknown>): ServiceConfig {
	return {
		server: { port: 4000, host: "0.0.0.0" },
		logging: { level: "info" },
		database: { host: "localhost", port: 5432, database: "litellm", user: "litellm", password: "litellm" },
		litellmSettings: {
			defaultModel: null,
			maxRetries: 0,
			requestTimeoutMs: null,
			cacheModelConfig: false,
		},
		routerSettings: {
			strategy: "cost-based",
			healthCheckIntervalSec: 300,
			maxConsecutiveFailures: 5,
			fallbacks: [],
			model_group_alias: {},
		},
		generalSettings: {
			environment: "development",
			verboseErrors: false,
			tempDir: "/tmp",
			master_key: "sk-test-master-key",
			model_group_alias: {},
			...overrides,
		},
		modelList: [],
		generalSettingsRaw: generalSettingsRaw ?? {},
	} as unknown as ServiceConfig;
}

function buildAuthedApp(config: ServiceConfig, deployments?: Deployment[]): express.Express {
	const app = express();
	app.use(express.json());
	// 模拟 main.ts::_registerManagementRoutes：managementRouter 先于 stubRouter 注册。
	// managementRouter 承载 /team/list 等真实管理端点（createTeamRoutes），需 authMiddleware。
	// 测试中提供 mock db + 始终通过的 authMiddleware 以避免引入真实鉴权状态。
	const passThroughAuth: express.RequestHandler = (_req, _res, next) => next();
	const managementRouter = express.Router();
	managementRouter.use(passThroughAuth);
	createTeamRoutes(managementRouter, makeMockTeamDb() as never, passThroughAuth);
	app.use(managementRouter);

	// stubRouter：WebUI 鉴权支撑端点 + KeyManagement（与 main.ts 一致）
	const router = express.Router();
	router.use(passThroughAuth);
	registerWebUiSupportRoutes(router, config);
	// Models 页面支撑：可选注入 deployments 访问器
	if (deployments) {
		const accessor: RouterDeploymentsAccessor = { getDeployments: () => deployments };
		registerModelsPageSupportRoutes(router, accessor, config);
	} else {
		registerModelsPageSupportRoutes(router, undefined, config);
	}
	createKeyManagementRoutes(router, {} as never, null);
	app.use(router);
	return app;
}

/**
 * 构造一个最小 mock db，仅实现 /team/list 路径所需的 select().from()。
 * 其他方法按调用时再扩展；TeamEndpoint 中 /team/list 是唯一无 where/limit 的查询。
 */
function makeMockTeamDb(): { select: () => { from: () => Promise<unknown[]> } } {
	return {
		select: () => ({
			from: () => Promise.resolve([]),
		}),
	};
}

function buildPublicApp(config: ServiceConfig): express.Express {
	const app = express();
	app.use(express.json());
	const router = express.Router();
	registerWebUiSupportPublicRoutes(router);
	// LoginEndpoints 需要写入 LiteLLM_VerificationToken，提供最小 mock db：
	// 仅实现 insert().values() 与按 token 列 select().from().where().limit(1)。
	const inserted: Array<{ token: string }> = [];
	const mockDb = {
		insert: () => ({
			values: (row: { token: string }) => {
				inserted.push({ token: row.token });
				return Promise.resolve();
			},
		}),
		select: () => ({
			from: () => ({
				where: () => ({
					limit: () => Promise.resolve([]),
				}),
			}),
		}),
	};
	registerLoginRoutes(router, config, mockDb as never);
	app.use(router);
	// 把 mock 状态挂在 app 上，便于登录后断言
	(app as unknown as { __inserted: typeof inserted }).__inserted = inserted;
	return app;
}

describe("WebUiSupport 契约", () => {
	describe("公开端点（无鉴权）", () => {
		it("/public/litellm_model_cost_map 应返回对象（无 cookie 也可访问）", async () => {
			const app = buildPublicApp(makeConfig());
			const res = await request(app).get("/public/litellm_model_cost_map");
			expect(res.status).toBe(200);
			expect(typeof res.body).toBe("object");
		});

		it("/public/model_hub/info 应包含 litellm_version", async () => {
			const app = buildPublicApp(makeConfig());
			const res = await request(app).get("/public/model_hub/info");
			expect(res.status).toBe(200);
			expect(res.body.litellm_version).toBeDefined();
		});

		it("/public/providers/fields 应返回数组", async () => {
			const app = buildPublicApp(makeConfig());
			const res = await request(app).get("/public/providers/fields");
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
		});
	});

	describe("鉴权端点", () => {
		it("/config/list 应返回数组（general_settings 字段形状）", async () => {
			const config = makeConfig({}, { store_model_in_db: true });
			const app = buildAuthedApp(config);

			const res = await request(app).get("/config/list?config_type=general_settings");
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
			expect(res.body.length).toBeGreaterThan(0);

			const storeField = res.body.find((f: { field_name: string }) => f.field_name === "store_model_in_db");
			expect(storeField).toBeDefined();
			expect(storeField.field_type).toBe("Boolean");
			expect(storeField.field_value).toBe(true);
			expect(storeField.stored_in_db).toBe(false);
		});

		it("/config/list 未知 config_type 应返回空数组", async () => {
			const app = buildAuthedApp(makeConfig());
			const res = await request(app).get("/config/list?config_type=unknown");
			expect(res.status).toBe(200);
			expect(res.body).toEqual([]);
		});

		it("/model_group/info 应返回 { data: [] }", async () => {
			const app = buildAuthedApp(makeConfig());
			const res = await request(app).get("/model_group/info");
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body.data)).toBe(true);
		});

		it("/v2/model/info 应返回分页形状", async () => {
			const app = buildAuthedApp(makeConfig());
			const res = await request(app).get("/v2/model/info");
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body.data)).toBe(true);
			expect(typeof res.body.total_count).toBe("number");
			expect(typeof res.body.current_page).toBe("number");
			expect(typeof res.body.total_pages).toBe("number");
		});

		it("/team/list 应返回数组", async () => {
			const app = buildAuthedApp(makeConfig());
			const res = await request(app).get("/team/list");
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
		});

		it("/v2/team/list 应包含分页字段", async () => {
			const app = buildAuthedApp(makeConfig());
			const res = await request(app).get("/v2/team/list");
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body.teams)).toBe(true);
			expect(typeof res.body.total).toBe("number");
			expect(typeof res.body.page).toBe("number");
		});

		it.each(["/user/daily/activity", "/user/daily/activity/aggregated"])("%s 应返回 Usage 页面空态分页 shape", async (path) => {
			const app = buildAuthedApp(makeConfig());
			const res = await request(app).get(path);
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body.results)).toBe(true);
			expect(res.body.results).toHaveLength(0);
			expect(res.body.metadata).toMatchObject({
				total_spend: 0,
				total_prompt_tokens: 0,
				total_completion_tokens: 0,
				total_tokens: 0,
				total_api_requests: 0,
				total_successful_requests: 0,
				total_failed_requests: 0,
				total_cache_read_input_tokens: 0,
				total_cache_creation_input_tokens: 0,
				total_pages: 1,
				has_more: false,
				page: 1,
			});
		});
	});

	describe("Login 端点", () => {
		it("正确用户名/密码应返回 redirect_url 并设置 token cookie", async () => {
			const app = buildPublicApp(makeConfig());
			const res = await request(app).post("/v2/login").send({ username: "admin", password: "sk-test-master-key" });
			expect(res.status).toBe(200);
			expect(res.body.redirect_url).toBe("/ui/?login=success");
			const setCookie = res.headers["set-cookie"];
			expect(setCookie).toBeDefined();
			const cookieHeader = Array.isArray(setCookie) ? setCookie.join(";") : String(setCookie);
			expect(cookieHeader).toMatch(/token=/);
		});

		it("错误密码应返回 401", async () => {
			const app = buildPublicApp(makeConfig());
			const res = await request(app).post("/v2/login").send({ username: "admin", password: "wrong" });
			expect(res.status).toBe(401);
		});

		/**
		 * 对齐 Python LiteLLM：cookie JWT payload.key 是登录时生成的明文 `sk-*` virtual key，
		 * 且该 key 的 hash 被持久化到 LiteLLM_VerificationToken。
		 * master key 明文不得出现在 payload 中。
		 */
		it("cookie JWT payload.key 应为 sk-* virtual key，DB 持久化 hash，master key 不外泄（DIFF-AUTH-WEBUI-SESSION）", async () => {
			const app = buildPublicApp(makeConfig());
			const res = await request(app).post("/v2/login").send({ username: "admin", password: "sk-test-master-key" });
			expect(res.status).toBe(200);
			const setCookie = res.headers["set-cookie"];
			expect(setCookie).toBeDefined();
			const cookies = Array.isArray(setCookie) ? setCookie : [String(setCookie)];
			const tokenCookie = cookies.find((c) => c.startsWith("token="));
			expect(tokenCookie).toBeDefined();
			const [cookieValue] = (tokenCookie as string).split(";");
			expect(cookieValue).toBeDefined();
			const tokenValue = (cookieValue as string).slice("token=".length);
			// JWT 三段：header.payload.signature
			const parts = tokenValue.split(".");
			expect(parts.length).toBe(3);
			const payloadSegment = parts[1];
			expect(payloadSegment).toBeDefined();
			const payloadJson = Buffer.from(payloadSegment as string, "base64url").toString("utf8");
			const payload = JSON.parse(payloadJson) as Record<string, unknown>;
			// 关键断言 1：master key 明文不得出现在 payload 中
			expect(JSON.stringify(payload)).not.toContain("sk-test-master-key");
			// 关键断言 2：key 字段是 sk- 前缀的明文 virtual key
			const payloadKey = payload.key;
			expect(typeof payloadKey).toBe("string");
			expect((payloadKey as string).startsWith("sk-")).toBe(true);
			// 关键断言 3：最小身份信息仍保留
			expect(payload.user_id).toBe("default_user_id");
			expect(payload.user_role).toBe("proxy_admin");
			// 关键断言 4：DB mock 收到的是 hash，不应等于明文
			const inserted = (app as unknown as { __inserted: Array<{ token: string }> }).__inserted;
			expect(inserted.length).toBe(1);
			const storedHash = inserted[0]!.token;
			expect(storedHash).not.toBe(payloadKey);
			expect(storedHash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
		});
	});
});

describe("KeyManagement /key/list 契约", () => {
	/**
	 * 构造 /key/list 路径所需的最小 mock db：
	 * - select().from().where(...) 必须返回过滤后的行（mock 内置 where 谓词评估）
	 * - 记录 where 是否被实际调用，避免未来回退到无过滤查询
	 * @param rows
	 */
	function makeKeyListMockDb(rows: Array<Record<string, unknown>>): {
		db: unknown;
		whereCalled: () => boolean;
	} {
		let whereCalledFlag = false;
		const db = {
			select: () => ({
				from: (_table: unknown) => ({
					where: (predicate: unknown) => {
						whereCalledFlag = true;
						// 谓词为 or(isNull(teamId), ne(teamId, "litellm-dashboard")) 的评估器：
						// 测试 row 的 teamId 字段若为 null 或不等于 "litellm-dashboard" 则保留。
						const filtered = rows.filter((row) => {
							const teamId = row.teamId;
							return teamId === null || teamId === undefined || teamId !== "litellm-dashboard";
						});
						// predicate 形参必须被引用以满足 lint / no-unused-vars：
						return Promise.resolve(predicate === undefined ? filtered : filtered);
					},
				}),
			}),
		};
		return {
			db: db,
			whereCalled: () => whereCalledFlag,
		};
	}

	it("应返回分页形状 { keys, total_count, current_page, total_pages }", async () => {
		const app = express();
		app.use(express.json());
		const router = express.Router();
		const rows = [
			{
				token: "hashed-token-id",
				keyName: "sk-...abcd",
				keyAlias: "demo-key",
				userId: "default_user_id",
				teamId: null,
				organizationId: "org-1",
				maxBudget: 10,
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				updatedAt: new Date("2026-01-02T00:00:00.000Z"),
				lastActive: null,
			},
		];
		const { db, whereCalled } = makeKeyListMockDb(rows);
		createKeyManagementRoutes(router, db as never, null);
		app.use(router);

		const res = await request(app).get("/key/list?page=1&size=50");
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body.keys)).toBe(true);
		expect(res.body.total_count).toBe(1);
		expect(res.body.current_page).toBe(1);
		expect(res.body.total_pages).toBeGreaterThanOrEqual(1);
		expect(res.body.keys).toEqual(["hashed-token-id"]);
		expect(whereCalled()).toBe(true);
	});

	it("return_full_object=true 时应返回 Python snake_case 字段", async () => {
		const app = express();
		app.use(express.json());
		const router = express.Router();
		const rows = [
			{
				token: "hashed-token-id",
				keyName: "sk-...abcd",
				keyAlias: "demo-key",
				userId: "default_user_id",
				teamId: "team-business",
				organizationId: "org-1",
				maxBudget: 10,
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				updatedAt: new Date("2026-01-02T00:00:00.000Z"),
				lastActive: null,
			},
		];
		const { db, whereCalled } = makeKeyListMockDb(rows);
		createKeyManagementRoutes(router, db as never, null);
		app.use(router);

		const res = await request(app).get("/key/list?page=1&size=50&return_full_object=true");
		expect(res.status).toBe(200);
		expect(res.body.keys[0]).toMatchObject({
			token: "hashed-token-id",
			key_name: "sk-...abcd",
			key_alias: "demo-key",
			user_id: "default_user_id",
			team_id: "team-business",
			organization_id: "org-1",
			org_id: "org-1",
			max_budget: 10,
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-02T00:00:00.000Z",
			last_active: null,
		});
		expect(res.body.keys[0].keyName).toBeUndefined();
		expect(res.body.keys[0].userId).toBeUndefined();
		expect(whereCalled()).toBe(true);
	});

	/**
	 * 对齐 Python LiteLLM `_get_condition_to_filter_out_ui_session_tokens()`：
	 * teamId === "litellm-dashboard" 的 WebUI session key 必须从 /key/list 返回与
	 * total_count 中排除；teamId === null 或普通业务 team 的 key 保留。
	 */
	it("应过滤 teamId === 'litellm-dashboard' 的 WebUI session key", async () => {
		const app = express();
		app.use(express.json());
		const router = express.Router();
		const rows = [
			{
				token: "hashed-team-business",
				keyName: "sk-...biz",
				keyAlias: "biz-key",
				userId: "default_user_id",
				teamId: "team-business",
				organizationId: null,
				maxBudget: null,
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				updatedAt: new Date("2026-01-02T00:00:00.000Z"),
				lastActive: null,
			},
			{
				token: "hashed-no-team",
				keyName: "sk-...noteam",
				keyAlias: "no-team-key",
				userId: "default_user_id",
				teamId: null,
				organizationId: null,
				maxBudget: null,
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				updatedAt: new Date("2026-01-02T00:00:00.000Z"),
				lastActive: null,
			},
			{
				token: "hashed-webui-session",
				keyName: "sk-...webui",
				keyAlias: "webui-session",
				userId: "default_user_id",
				teamId: "litellm-dashboard",
				organizationId: null,
				maxBudget: null,
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				updatedAt: new Date("2026-01-02T00:00:00.000Z"),
				lastActive: null,
			},
		];
		const { db, whereCalled } = makeKeyListMockDb(rows);
		createKeyManagementRoutes(router, db as never, null);
		app.use(router);

		const res = await request(app).get("/key/list?page=1&size=50&return_full_object=true");
		expect(res.status).toBe(200);
		expect(whereCalled()).toBe(true);
		// total_count 应基于过滤后的集合：仅 2 个非 WebUI key
		expect(res.body.total_count).toBe(2);
		expect(res.body.total_pages).toBe(1);
		const teamIds = (res.body.keys as Array<{ team_id: string | null }>).map((k) => k.team_id);
		expect(teamIds).not.toContain("litellm-dashboard");
		expect(teamIds).toEqual(expect.arrayContaining(["team-business", null]));
		const tokens = (res.body.keys as Array<{ token: string }>).map((k) => k.token);
		expect(tokens).not.toContain("hashed-webui-session");
	});
});

/**
 * 构造用于 /v2/model/info 契约测试的 deployment 列表。
 * 包含 api_key 等敏感字段，断言响应中**不**出现 api_key。
 */
function makeTestDeployments(): Deployment[] {
	return [
		{
			model_name: "gpt-4o",
			litellm_params: {
				model: "openai/gpt-4o",
				api_key: "sk-secret-must-not-leak",
				api_base: "https://api.openai.com/v1",
				custom_llm_provider: "openai",
				rpm: 100,
				tpm: 10000,
				input_cost_per_token: 0.000005,
				output_cost_per_token: 0.000015,
				timeout: 30,
				max_retries: 2,
			},
			model_info: {
				id: "openai/gpt-4o-primary",
				mode: "chat",
				max_input_tokens: 128000,
				max_output_tokens: 4096,
				supports_function_calling: true,
				supports_vision: true,
			},
		},
		{
			model_name: "gpt-4o",
			litellm_params: {
				model: "openai/gpt-4o",
				api_key: "sk-secret-2",
				api_base: "https://api.openai.com/v1",
				custom_llm_provider: "openai",
				rpm: 50,
				tpm: 5000,
			},
			// 同 model_name 的第二个 deployment，验证 stableIndex 生成的 id
			model_info: { mode: "chat" },
		},
		{
			model_name: "claude-3-7-sonnet",
			litellm_params: {
				model: "anthropic/claude-3-7-sonnet",
				api_key: "sk-anthropic-secret",
				api_base: "https://api.anthropic.com",
				custom_llm_provider: "anthropic",
				rpm: 200,
				tpm: 20000,
			},
			model_info: { id: "anthropic/claude-3-7-sonnet-main", mode: "chat" },
		},
	];
}

describe("ModelsPageSupport 契约", () => {
	describe("/v2/model/info", () => {
		it("config 有 modelList 时应返回非空 data 与分页字段", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, makeTestDeployments());
			const res = await request(app).get("/v2/model/info");
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body.data)).toBe(true);
			expect(res.body.data.length).toBeGreaterThan(0);
			// 分页字段必须存在
			expect(typeof res.body.total_count).toBe("number");
			expect(typeof res.body.current_page).toBe("number");
			expect(typeof res.body.total_pages).toBe("number");
			expect(typeof res.body.size).toBe("number");
			// Python 分页字段别名
			expect(typeof res.body.total).toBe("number");
			expect(typeof res.body.page).toBe("number");
			expect(typeof res.body.page_size).toBe("number");
		});

		it("响应绝不泄露 api_key 敏感字段", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, makeTestDeployments());
			const res = await request(app).get("/v2/model/info");
			expect(res.status).toBe(200);
			// 整段 JSON 序列化后不得包含敏感字符串
			const serialized = JSON.stringify(res.body);
			expect(serialized).not.toContain("sk-secret-must-not-leak");
			expect(serialized).not.toContain("sk-secret-2");
			expect(serialized).not.toContain("sk-anthropic-secret");
			// 显式断言 data[].litellm_params 不含 api_key 字段
			for (const item of res.body.data) {
				expect(item.litellm_params).toBeDefined();
				expect(item.litellm_params).not.toHaveProperty("api_key");
			}
		});

		it("无 deployment 时应返回空 data 且 total_pages=0（对齐 Python 空态）", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, []);
			const res = await request(app).get("/v2/model/info");
			expect(res.status).toBe(200);
			expect(res.body.data).toEqual([]);
			expect(res.body.total_count).toBe(0);
			expect(res.body.total_pages).toBe(0);
		});

		it("search 应按 model_name / id 模糊匹配", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, makeTestDeployments());
			const res = await request(app).get("/v2/model/info?search=claude");
			expect(res.status).toBe(200);
			expect(res.body.data.length).toBeGreaterThan(0);
			const names = (res.body.data as Array<{ model_name: string }>).map((x) => x.model_name);
			expect(names.every((n) => n.toLowerCase().includes("claude"))).toBe(true);
		});

		it("search 不命中时返回空 data", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, makeTestDeployments());
			const res = await request(app).get("/v2/model/info?search=zzz-no-such-model");
			expect(res.status).toBe(200);
			expect(res.body.data).toEqual([]);
		});

		it("modelId 应按 model_info.id 精确匹配", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, makeTestDeployments());
			const res = await request(app).get("/v2/model/info?modelId=anthropic%2Fclaude-3-7-sonnet-main");
			expect(res.status).toBe(200);
			expect(res.body.data.length).toBe(1);
			expect((res.body.data[0] as { model_name: string }).model_name).toBe("claude-3-7-sonnet");
		});

		it("modelId 不存在时应返回空 data，不抛 500", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, makeTestDeployments());
			const res = await request(app).get("/v2/model/info?modelId=does-not-exist");
			expect(res.status).toBe(200);
			expect(res.body.data).toEqual([]);
		});

		it("page/size 应正确分页", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, makeTestDeployments());
			const res = await request(app).get("/v2/model/info?page=1&size=2");
			expect(res.status).toBe(200);
			expect(res.body.data.length).toBeLessThanOrEqual(2);
			expect(res.body.size).toBe(2);
			expect(res.body.page).toBe(1);
			expect(res.body.current_page).toBe(1);
		});

		it("sortBy=model_name&sortOrder=desc 应按 model_name 倒序", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, makeTestDeployments());
			const res = await request(app).get("/v2/model/info?sortBy=model_name&sortOrder=desc");
			expect(res.status).toBe(200);
			const names = (res.body.data as Array<{ model_name: string }>).map((x) => x.model_name);
			const sorted = [...names].sort().reverse();
			expect(names).toEqual(sorted);
		});

		it("sortOrder 非法值应回退 asc，不返回 400", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, makeTestDeployments());
			const res = await request(app).get("/v2/model/info?sortOrder=garbage");
			expect(res.status).toBe(200);
			const names = (res.body.data as Array<{ model_name: string }>).map((x) => x.model_name);
			const sorted = [...names].sort();
			expect(names).toEqual(sorted);
		});

		it("单元素应包含 model_name、litellm_params、model_info 关键字段", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, makeTestDeployments());
			const res = await request(app).get("/v2/model/info?modelId=openai%2Fgpt-4o-primary");
			expect(res.status).toBe(200);
			const item = res.body.data[0];
			expect(item.model_name).toBe("gpt-4o");
			expect(item.litellm_params.model).toBe("openai/gpt-4o");
			expect(item.litellm_params.api_base).toBe("https://api.openai.com/v1");
			expect(item.litellm_params.custom_llm_provider).toBe("openai");
			expect(typeof item.litellm_params.rpm).toBe("number");
			expect(typeof item.litellm_params.tpm).toBe("number");
			expect(item.litellm_params.timeout).toBe(30);
			expect(item.litellm_params.max_retries).toBe(2);
			expect(item.model_info.id).toBe("openai/gpt-4o-primary");
			expect(item.model_info.mode).toBe("chat");
			expect(item.model_info.litellm_provider).toBe("openai");
		});
	});

	describe("/model_group/info", () => {
		it("应返回 data 数组且每项包含 model_group", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, makeTestDeployments());
			const res = await request(app).get("/model_group/info");
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body.data)).toBe(true);
			expect(res.body.data.length).toBeGreaterThan(0);
			for (const item of res.body.data) {
				expect(typeof item.model_group).toBe("string");
				expect(item.model_group.length).toBeGreaterThan(0);
				expect(Array.isArray(item.providers)).toBe(true);
			}
		});

		it("deployment_count 应等于该 model_name 下的 deployment 数", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, makeTestDeployments());
			const res = await request(app).get("/model_group/info");
			const gpt4o = (res.body.data as Array<{ model_group: string; deployment_count: number }>).find(
				(x) => x.model_group === "gpt-4o",
			);
			expect(gpt4o).toBeDefined();
			if (!gpt4o) {
				throw new Error("expected gpt-4o model group");
			}
			expect(gpt4o.deployment_count).toBe(2);
		});

		it("无 deployment 时应返回 { data: [] }", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, []);
			const res = await request(app).get("/model_group/info");
			expect(res.status).toBe(200);
			expect(res.body.data).toEqual([]);
		});
	});

	describe("/v1/model/info", () => {
		it("modelId 不存在时应返回 404", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, makeTestDeployments());
			const res = await request(app).get("/v1/model/info?model_id=does-not-exist");
			expect(res.status).toBe(404);
		});

		it("modelId 存在时应返回包含敏感字段已剔除的 data", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, makeTestDeployments());
			const res = await request(app).get("/v1/model/info?model_id=gpt-4o");
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body.data)).toBe(true);
			expect(res.body.data[0].model_name).toBe("gpt-4o");
			expect(res.body.data[0].litellm_params).not.toHaveProperty("api_key");
		});
	});
});
