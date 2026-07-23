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
import { webUiCsrfProtection } from "../auth/UserApiKeyAuth";
import { createKeyManagementRoutes } from "../management/KeyManagementEndpoint";
import { createTeamRoutes } from "../management/TeamEndpoint";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import type { ServiceConfig } from "../core/config";
import type { RouterDeploymentsAccessor } from "./ModelsPageSupportEndpoints";
import { Router as LiteLLMRouter } from "../router/Router";
import { RoutingStrategyName } from "../types/router";
import type { Deployment } from "../types/router";
import { liteLLM_DailyUserSpend } from "../db/schema/dailyUserSpend";
import { liteLLM_DailyTagSpend } from "../db/schema/dailyTagSpend";
import { liteLLM_DailyTeamSpend } from "../db/schema/dailyTeamSpend";
import { liteLLM_DailyOrganizationSpend } from "../db/schema/dailyOrganizationSpend";
import { liteLLM_DailyEndUserSpend } from "../db/schema/dailyEndUserSpend";
import { liteLLM_DailyAgentSpend } from "../db/schema/dailyAgentSpend";
import { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";
import { liteLLM_DeletedVerificationToken } from "../db/schema/deleted-verification-tokens";
import { ModelCostMapService } from "../cost/ModelCostMapService";

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

function makeCostMapService(rawJson: string, env: NodeJS.ProcessEnv = { LITELLM_LOCAL_MODEL_COST_MAP: "true" }): ModelCostMapService {
	return new ModelCostMapService({ bundledRawJson: rawJson, env: env });
}

function buildAuthedApp(
	config: ServiceConfig,
	deployments?: Deployment[],
	auth: NonNullable<express.Request["auth"]> = { api_key: "sk-test-admin", user_role: "proxy_admin" },
	configDb?: unknown,
	litellmRouter?: LiteLLMRouter,
	costMapService?: ModelCostMapService,
): express.Express {
	const app = express();
	app.use(express.json());
	// 模拟 main.ts::_registerManagementRoutes：managementRouter 先于 stubRouter 注册。
	// managementRouter 承载 /team/list 等真实管理端点（createTeamRoutes），需 authMiddleware。
	// 测试中提供 mock db + 始终通过的 authMiddleware 以避免引入真实鉴权状态。
	const passThroughAuth: express.RequestHandler = (req, _res, next) => {
		req.auth = auth;
		next();
	};
	const managementRouter = express.Router();
	managementRouter.use(passThroughAuth);
	createTeamRoutes(managementRouter, makeMockTeamDb() as never, passThroughAuth);
	app.use(managementRouter);

	// stubRouter：WebUI 鉴权支撑端点 + KeyManagement（与 main.ts 一致）
	const router = express.Router();
	router.use(passThroughAuth);
	registerWebUiSupportRoutes(router, config, (configDb ?? makeMockConfigDb().db) as never, litellmRouter);
	// Models 页面支撑：优先注入 deployments 访问器；否则注入 litellmRouter（含 getFallbacks）
	if (deployments) {
		const accessor: RouterDeploymentsAccessor = { getDeployments: () => deployments };
		registerModelsPageSupportRoutes(router, accessor, config, costMapService);
	} else {
		registerModelsPageSupportRoutes(router, litellmRouter, config, costMapService);
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

/**
 * 构造 LiteLLM_Config 内存 mock db。
 * ConfigRepository 与 DbConfigProvider 均为全表扫描（select().from() 直接 await 取全行，
 * from() 返回值需 thenable）；写路径为 insert().values().onConflictDoUpdate()。
 * 返回 store 便于断言落库内容。
 * @param initial - 预置 param_name → param_value
 */
function makeMockConfigDb(initial: Record<string, unknown> = {}) {
	const store = new Map<string, unknown>(Object.entries(initial));
	const selectAll = (): Promise<Array<{ param_name: string; param_value: unknown }>> => {
		const rows = Array.from(store, ([param_name, param_value]) => ({ param_name: param_name, param_value: param_value }));
		return Promise.resolve(rows);
	};
	const db = {
		select: () => ({
			from: () => {
				const promise = selectAll();
				return Object.assign(promise, {
					where: () => promise,
					limit: () => promise,
				});
			},
		}),
		insert: () => ({
			values: (row: { param_name: string; param_value: unknown }) => ({
				onConflictDoUpdate: () => {
					store.set(row.param_name, row.param_value);
					return Promise.resolve();
				},
			}),
		}),
	};
	return { db: db, store: store };
}

interface DailyActivityTestRow {
	readonly date: string;
	readonly api_key: string;
	readonly model: string | null;
	readonly model_group: string | null;
	readonly custom_llm_provider: string | null;
	readonly mcp_namespaced_tool_name: string | null;
	readonly endpoint: string | null;
	readonly prompt_tokens: number;
	readonly completion_tokens: number;
	readonly cache_read_input_tokens: number;
	readonly cache_creation_input_tokens: number;
	readonly spend: number;
	readonly api_requests: number;
	readonly successful_requests: number;
	readonly failed_requests: number;
	readonly [key: string]: unknown;
}

interface DailyActivityKeyMetadataTestRow {
	readonly token: string;
	readonly keyAlias: string | null;
	readonly keyName: string | null;
	readonly teamId: string | null;
	readonly deletedAt?: Date | null;
}

interface DailyActivityDbQueryLog {
	activeQueries: number;
	deletedQueries: number;
	readonly deletedQueryValues: string[];
}

/**
 * 提取 Drizzle SQL predicate 内的字符串参数，供批量查询范围断言使用。
 * @param value
 * @param result
 * @param seen
 */
function collectSqlStringValues(value: unknown, result: string[] = [], seen: WeakSet<object> = new WeakSet()): string[] {
	if (typeof value === "string") {
		result.push(value);
		return result;
	}
	if (typeof value !== "object" || value === null || seen.has(value)) {
		return result;
	}
	seen.add(value);
	for (const child of Object.values(value)) {
		collectSqlStringValues(child, result, seen);
	}
	return result;
}

/**
 * 构造 daily activity 查询及 active/deleted key metadata 批量查询 mock。
 * @param rowsByTable - DailySpend 表数据
 * @param activeKeys - active key metadata
 * @param deletedKeys - deleted key metadata（按 deletedAt DESC）
 * @param failDeletedQuery - deleted 查询是否失败
 */
function makeMockDailyActivityDb(
	rowsByTable: ReadonlyMap<unknown, readonly DailyActivityTestRow[]>,
	activeKeys: readonly DailyActivityKeyMetadataTestRow[] = [],
	deletedKeys: readonly DailyActivityKeyMetadataTestRow[] = [],
	failDeletedQuery = false,
): { readonly db: unknown; readonly queryLog: DailyActivityDbQueryLog } {
	const queryLog: DailyActivityDbQueryLog = { activeQueries: 0, deletedQueries: 0, deletedQueryValues: [] };
	const db = {
		select: (selection?: unknown) => ({
			from: (table: unknown) => {
				if (table === LiteLLM_VerificationToken || table === liteLLM_DeletedVerificationToken) {
					const isDeleted = table === liteLLM_DeletedVerificationToken;
					const metadataRows = isDeleted ? deletedKeys : activeKeys;
					const metadataQuery = {
						where: (predicate: unknown) => {
							if (isDeleted) {
								queryLog.deletedQueries += 1;
								queryLog.deletedQueryValues.push(...collectSqlStringValues(predicate));
							} else {
								queryLog.activeQueries += 1;
							}
							return metadataQuery;
						},
						orderBy: () => metadataQuery,
						then: <TResult1 = DailyActivityKeyMetadataTestRow[]>(
							onfulfilled?: ((value: DailyActivityKeyMetadataTestRow[]) => TResult1 | PromiseLike<TResult1>) | null,
							onrejected?: ((reason: unknown) => TResult1 | PromiseLike<TResult1>) | null,
						) =>
							(isDeleted && failDeletedQuery
								? Promise.reject(new Error("deleted metadata unavailable"))
								: Promise.resolve([...metadataRows])
							).then(onfulfilled, onrejected),
					};
					return metadataQuery;
				}

				const rows = [...(rowsByTable.get(table) ?? [])];
				if (selection !== undefined) {
					return {
						where: () => Promise.resolve([{ count: rows.length }]),
					};
				}
				let limit = rows.length;
				let offset = 0;
				const query = {
					where: () => query,
					orderBy: () => query,
					limit: (value: number) => {
						limit = value;
						return query;
					},
					offset: (value: number) => {
						offset = value;
						return query;
					},
					then: <TResult1 = DailyActivityTestRow[]>(
						onfulfilled?: ((value: DailyActivityTestRow[]) => TResult1 | PromiseLike<TResult1>) | null,
					) => Promise.resolve(rows.slice(offset, offset + limit)).then(onfulfilled),
				};
				return query;
			},
		}),
	};
	return { db: db, queryLog: queryLog };
}

function buildPublicApp(config: ServiceConfig, costMapService?: ModelCostMapService): express.Express {
	const app = express();
	app.use(express.json());
	const router = express.Router();
	registerWebUiSupportPublicRoutes(router, costMapService);
	// LoginEndpoints 需要写入 LiteLLM_VerificationToken，提供最小 mock db：
	// 仅实现 insert().values() 与按 token 列 select().from().where().limit(1)。
	const inserted: Array<Record<string, unknown>> = [];
	const mockDb = {
		insert: () => ({
			values: (row: Record<string, unknown>) => {
				inserted.push(row);
				return Promise.resolve();
			},
		}),
		update: () => ({
			set: (values: Record<string, unknown>) => ({
				where: () => {
					Object.assign(inserted[0] ?? {}, values);
					return Promise.resolve();
				},
			}),
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
	afterEach(async () => {
		// dbConfigProvider 为全局单例：配置写路径测试会 initialize 内存 mock db，
		// 复位为空库避免污染后续读取方（如 /get/config/callbacks 的 DB 优先语义）
		await dbConfigProvider.initialize(makeMockConfigDb().db as never);
	});

	describe("公开端点（无鉴权）", () => {
		it("/public/litellm_model_cost_map 应返回对象（无 cookie 也可访问）", async () => {
			const app = buildPublicApp(makeConfig());
			const res = await request(app).get("/public/litellm_model_cost_map");
			expect(res.status).toBe(200);
			expect(typeof res.body).toBe("object");
		});

		it("/public/litellm_model_cost_map 返回注入服务的当前 snapshot", async () => {
			const app = buildPublicApp(
				makeConfig(),
				makeCostMapService(JSON.stringify({ dynamic: { input_cost_per_token: 1, output_cost_per_token: 2 } })),
			);

			const res = await request(app).get("/public/litellm_model_cost_map");

			expect(res.status).toBe(200);
			expect(res.body).toEqual({ dynamic: { input_cost_per_token: 1, output_cost_per_token: 2 } });
		});

		it("/public/model_hub/info 应包含 litellm_version", async () => {
			const app = buildPublicApp(makeConfig());
			const res = await request(app).get("/public/model_hub/info");
			expect(res.status).toBe(200);
			expect(res.body.litellm_version).toBeDefined();
		});

		it("/public/providers/fields 应返回非空 provider 字段清单（对齐 Python 109 个 provider）", async () => {
			const app = buildPublicApp(makeConfig());
			const res = await request(app).get("/public/providers/fields");
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
			expect(res.body.length).toBeGreaterThan(100);
			const first = res.body[0];
			expect(typeof first.provider).toBe("string");
			expect(typeof first.provider_display_name).toBe("string");
			expect(typeof first.litellm_provider).toBe("string");
			expect(Array.isArray(first.credential_fields)).toBe(true);
			expect(first.credential_fields.length).toBeGreaterThan(0);
			const field = first.credential_fields[0];
			expect(typeof field.key).toBe("string");
			expect(typeof field.label).toBe("string");
			expect(typeof field.field_type).toBe("string");

			const anthropic = res.body.find((provider: { provider: string }) => provider.provider === "Anthropic");
			expect(anthropic.credential_fields[0]).toEqual({
				key: "api_base",
				label: "Upstream API Base",
				placeholder: "https://api.anthropic.com",
				tooltip:
					"Optional. Use only for a private Anthropic endpoint or reverse proxy. Do not enter this LiteLLM proxy URL, which would cause recursive requests.",
				required: false,
				field_type: "text",
				options: null,
				default_value: null,
			});
			expect(anthropic.credential_fields[1].key).toBe("api_key");
		});

		it("/public/litellm_model_cost_map 应返回全量成本映射（对齐 Python 3000+ 条目）", async () => {
			const app = buildPublicApp(makeConfig());
			const res = await request(app).get("/public/litellm_model_cost_map");
			expect(res.status).toBe(200);
			expect(typeof res.body).toBe("object");
			expect(Object.keys(res.body).length).toBeGreaterThan(3000);
			// 抽样验证条目结构（含定价字段）
			const gpt4o = res.body["gpt-4o"];
			expect(gpt4o).toBeDefined();
			expect(typeof gpt4o.input_cost_per_token).toBe("number");
		});

		it("/get/ui_settings 的 field_schema 应包含 enabled_ui_pages_internal_users.items（对齐 Python）", async () => {
			const app = buildPublicApp(makeConfig());
			const res = await request(app).get("/get/ui_settings");
			expect(res.status).toBe(200);
			const fieldSchema = res.body.field_schema;
			expect(fieldSchema.description).toBe("Configuration for UI-specific flags");
			const pagesField = fieldSchema.properties.enabled_ui_pages_internal_users;
			expect(pagesField.type).toBe("array");
			expect(pagesField.items).toEqual({ type: "string" });
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

		it("/config/list 缺 config_type 应返回 422 FastAPI 风格（对齐 Python）", async () => {
			const app = buildAuthedApp(makeConfig());
			const res = await request(app).get("/config/list");
			expect(res.status).toBe(422);
			expect(Array.isArray(res.body.detail)).toBe(true);
			expect(res.body.detail[0]).toMatchObject({
				loc: ["query", "config_type"],
				msg: "Field required",
				type: "missing",
			});
		});

		it("/config/list 非法 config_type 应返回 422 literal_error（对齐 Python）", async () => {
			const app = buildAuthedApp(makeConfig());
			const res = await request(app).get("/config/list?config_type=unknown");
			expect(res.status).toBe(422);
			expect(res.body.detail[0]).toMatchObject({
				loc: ["query", "config_type"],
				msg: "Input should be 'general_settings'",
				type: "literal_error",
			});
		});

		it("/config/update 保存 Spend Logs Settings 并让 /config/list 可读", async () => {
			const { db } = makeMockConfigDb();
			await dbConfigProvider.initialize(db as never);
			const app = buildAuthedApp(makeConfig(), undefined, undefined, db);

			const updateRes = await request(app)
				.post("/config/update")
				.send({
					general_settings: {
						store_prompts_in_spend_logs: true,
						maximum_spend_logs_retention_period: "30d",
					},
				});
			expect(updateRes.status).toBe(200);
			expect(updateRes.body.message).toBe("Config updated successfully");

			const listRes = await request(app).get("/config/list?config_type=general_settings");
			const fields = listRes.body as Array<{ field_name: string; field_value: unknown; stored_in_db: boolean | null }>;
			const storePromptsField = fields.find((field) => field.field_name === "store_prompts_in_spend_logs");
			const retentionField = fields.find((field) => field.field_name === "maximum_spend_logs_retention_period");
			expect(storePromptsField?.field_value).toBe(true);
			// 值来自 DB（B3 起 /config/update 落 LiteLLM_Config），stored_in_db 对齐 Python 标记 true
			expect(storePromptsField?.stored_in_db).toBe(true);
			expect(retentionField?.field_value).toBe("30d");
			expect(retentionField?.stored_in_db).toBe(true);
		});

		it("/config/update 深合并进现有 DB 值（合并不是整段替换）", async () => {
			const { db, store } = makeMockConfigDb({
				general_settings: { store_model_in_db: true, alerting: ["slack"], nested: { keep: 1, drop: 1 } },
			});
			await dbConfigProvider.initialize(db as never);
			const app = buildAuthedApp(makeConfig(), undefined, undefined, db);

			const res = await request(app)
				.post("/config/update")
				.send({
					general_settings: { max_parallel_requests: 10, nested: { drop: 2, add: 3 } },
				});
			expect(res.status).toBe(200);

			const stored = store.get("general_settings") as Record<string, unknown>;
			// 未携带字段保留；同名字段覆盖；嵌套对象递归合并
			expect(stored["store_model_in_db"]).toBe(true);
			expect(stored["alerting"]).toEqual(["slack"]);
			expect(stored["max_parallel_requests"]).toBe(10);
			expect(stored["nested"]).toEqual({ keep: 1, drop: 2, add: 3 });
		});

		it("/config/update 剔除 model_list 且写入 router_settings（对齐 Python save_config）", async () => {
			const { db, store } = makeMockConfigDb();
			await dbConfigProvider.initialize(db as never);
			const app = buildAuthedApp(makeConfig(), undefined, undefined, db);

			const res = await request(app)
				.post("/config/update")
				.send({
					model_list: [{ model_name: "gpt-4o" }],
					router_settings: { fallbacks: [{ "gpt-4o": ["gpt-4o-mini"] }] },
					litellm_settings: { drop_params: true },
					environment_variables: { OPENAI_API_KEY: "sk-x" },
				});
			expect(res.status).toBe(200);

			expect(store.has("model_list")).toBe(false);
			expect(store.get("router_settings")).toEqual({ fallbacks: [{ "gpt-4o": ["gpt-4o-mini"] }] });
			expect(store.get("litellm_settings")).toEqual({ drop_params: true });
			expect(store.get("environment_variables")).toEqual({ OPENAI_API_KEY: "sk-x" });
		});

		it("/config/field/update 单字段写入并保留其他 DB 字段", async () => {
			const { db, store } = makeMockConfigDb({
				general_settings: { store_model_in_db: true },
			});
			await dbConfigProvider.initialize(db as never);
			const app = buildAuthedApp(makeConfig(), undefined, undefined, db);

			const res = await request(app)
				.post("/config/field/update")
				.send({ field_name: "max_parallel_requests", field_value: 5, config_type: "general_settings" });
			expect(res.status).toBe(200);
			expect(res.body).toEqual({
				param_name: "general_settings",
				param_value: { store_model_in_db: true, max_parallel_requests: 5 },
			});
			expect(store.get("general_settings")).toEqual({ store_model_in_db: true, max_parallel_requests: 5 });
		});

		it("/config/field/update 非法 field_name 返回 400（对齐 Python）", async () => {
			const { db } = makeMockConfigDb();
			await dbConfigProvider.initialize(db as never);
			const app = buildAuthedApp(makeConfig(), undefined, undefined, db);

			const res = await request(app)
				.post("/config/field/update")
				.send({ field_name: "not_a_field", field_value: 1, config_type: "general_settings" });
			expect(res.status).toBe(400);
			expect(res.body.detail).toEqual({ error: "Invalid field=not_a_field passed in." });
		});

		it("/config/field/update 缺 config_type 返回 422（对齐 FastAPI）", async () => {
			const { db } = makeMockConfigDb();
			await dbConfigProvider.initialize(db as never);
			const app = buildAuthedApp(makeConfig(), undefined, undefined, db);

			const res = await request(app).post("/config/field/update").send({ field_name: "otel", field_value: true });
			expect(res.status).toBe(422);
			expect(res.body.detail[0]).toMatchObject({ loc: ["body", "config_type"], type: "missing" });
		});

		it("/config/field/delete 删除单字段并回写", async () => {
			const { db, store } = makeMockConfigDb({
				general_settings: { store_model_in_db: true, max_parallel_requests: 5 },
			});
			await dbConfigProvider.initialize(db as never);
			const app = buildAuthedApp(makeConfig(), undefined, undefined, db);

			const res = await request(app)
				.post("/config/field/delete")
				.send({ field_name: "max_parallel_requests", config_type: "general_settings" });
			expect(res.status).toBe(200);
			expect(res.body).toEqual({
				param_name: "general_settings",
				param_value: { store_model_in_db: true },
			});
			expect(store.get("general_settings")).toEqual({ store_model_in_db: true });
		});

		it("/config/field/delete DB 无 general_settings 时返回 400（对齐 Python）", async () => {
			const { db } = makeMockConfigDb();
			await dbConfigProvider.initialize(db as never);
			const app = buildAuthedApp(makeConfig(), undefined, undefined, db);

			const res = await request(app).post("/config/field/delete").send({ field_name: "otel", config_type: "general_settings" });
			expect(res.status).toBe(400);
			expect(res.body.detail).toEqual({ error: "Field name=otel not in config" });
		});

		it("PATCH /update/ui_theme_settings 写 litellm_settings.ui_theme_config 并可被 /get/ui_theme_settings 读到", async () => {
			const { db, store } = makeMockConfigDb({
				litellm_settings: { drop_params: true },
			});
			await dbConfigProvider.initialize(db as never);
			const app = buildAuthedApp(makeConfig(), undefined, undefined, db);

			const res = await request(app).patch("/update/ui_theme_settings").send({ logo_url: "https://example.com/logo.png" });
			expect(res.status).toBe(200);
			expect(res.body).toEqual({
				message: "UI theme settings updated successfully.",
				status: "success",
				theme_config: { logo_url: "https://example.com/logo.png" },
			});

			// 其他 litellm_settings 键保留，ui_theme_config 整体替换
			expect(store.get("litellm_settings")).toEqual({
				drop_params: true,
				ui_theme_config: { logo_url: "https://example.com/logo.png" },
			});
			// 环境变量同步（对齐 Python）
			expect(process.env.UI_LOGO_PATH).toBe("https://example.com/logo.png");

			// 公开读端点经 dbConfigProvider 读取，写后 refreshNow 立即生效
			const publicApp = buildPublicApp(makeConfig());
			const themeRes = await request(publicApp).get("/get/ui_theme_settings");
			expect(themeRes.status).toBe(200);
			expect(themeRes.body.values.logo_url).toBe("https://example.com/logo.png");

			delete process.env.UI_LOGO_PATH;
		});

		it("/budget/settings 缺 budget_id 应返回 422 FastAPI 风格（对齐 Python）", async () => {
			const app = buildAuthedApp(makeConfig());
			const res = await request(app).get("/budget/settings");
			expect(res.status).toBe(422);
			expect(Array.isArray(res.body.detail)).toBe(true);
			expect(res.body.detail[0]).toMatchObject({
				loc: ["query", "budget_id"],
				msg: "Field required",
				type: "missing",
			});
		});

		it("/budget/settings 带 budget_id 应返回 ConfigList 字段数组（对齐 Python 字段顺序与形状）", async () => {
			const app = buildAuthedApp(makeConfig());
			const res = await request(app).get("/budget/settings?budget_id=nonexistent");
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
			expect(res.body.map((f: { field_name: string }) => f.field_name)).toEqual([
				"max_budget",
				"soft_budget",
				"max_parallel_requests",
				"tpm_limit",
				"rpm_limit",
				"budget_duration",
				"model_max_budget",
			]);
			for (const field of res.body) {
				expect(typeof field.field_type).toBe("string");
				expect(typeof field.field_description).toBe("string");
				expect(field.field_value).toBeNull();
				expect(field.stored_in_db).toBe(true);
				expect(field.field_default_value).toBeNull();
				expect(field.premium_field).toBe(false);
				expect(field.nested_fields).toBeNull();
			}
		});

		it("/active/callbacks 空配置应返回 Python 同构的空态响应", async () => {
			const app = buildAuthedApp(makeConfig());
			const res = await request(app).get("/active/callbacks");
			expect(res.status).toBe(200);
			expect(res.body.alerting).toBe("None");
			for (const key of [
				"litellm.callbacks",
				"litellm.input_callback",
				"litellm.failure_callback",
				"litellm.success_callback",
				"litellm._async_success_callback",
				"litellm._async_failure_callback",
				"litellm._async_input_callback",
				"all_litellm_callbacks",
			]) {
				expect(Array.isArray(res.body[key])).toBe(true);
			}
			expect(res.body.num_callbacks).toBe(0);
			expect(res.body.num_alerting).toBe(0);
			expect(typeof res.body["litellm.request_timeout"]).toBe("number");
		});

		it("/active/callbacks 应反映 litellm_settings 配置的回调（num_callbacks 为七列表拼接长度）", async () => {
			const config = {
				...makeConfig(),
				litellmSettingsRaw: {
					success_callback: ["langfuse"],
					failure_callback: ["slack"],
				},
			} as ServiceConfig;
			const app = buildAuthedApp(config);
			const res = await request(app).get("/active/callbacks");
			expect(res.status).toBe(200);
			expect(res.body["litellm.success_callback"]).toEqual(["langfuse"]);
			expect(res.body["litellm.failure_callback"]).toEqual(["slack"]);
			expect(res.body["litellm._async_success_callback"]).toEqual(["langfuse"]);
			expect(res.body["litellm._async_failure_callback"]).toEqual(["slack"]);
			// success+failure 各出现于 sync 与 async 列表，共 4 项
			expect(res.body.num_callbacks).toBe(4);
			expect(res.body.all_litellm_callbacks).toHaveLength(4);
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

		it("/user/daily/activity 缺日期范围应返回 400", async () => {
			const app = buildAuthedApp(makeConfig());
			const res = await request(app).get("/user/daily/activity");
			expect(res.status).toBe(400);
			expect(res.body.detail).toEqual({ error: "Please provide start_date and end_date" });
		});

		it.each([
			["/user/daily/activity", liteLLM_DailyUserSpend, "user_id", "user-1"],
			["/tag/daily/activity", liteLLM_DailyTagSpend, "tag", "production"],
			["/team/daily/activity", liteLLM_DailyTeamSpend, "team_id", "team-1"],
			["/organization/daily/activity", liteLLM_DailyOrganizationSpend, "organization_id", "org-1"],
			["/customer/daily/activity", liteLLM_DailyEndUserSpend, "end_user_id", "customer-1"],
			["/agent/daily/activity", liteLLM_DailyAgentSpend, "agent_id", "agent-1"],
		] as const)("%s 应查询对应 DailySpend 表并返回聚合数据", async (path, table, entityField, entityValue) => {
			const row: DailyActivityTestRow = {
				date: "2026-01-02",
				api_key: "key-hash",
				model: "provider/model",
				model_group: "logical-model",
				custom_llm_provider: "provider",
				mcp_namespaced_tool_name: "server/tool",
				endpoint: "/v1/chat/completions",
				prompt_tokens: 10,
				completion_tokens: 4,
				cache_read_input_tokens: 2,
				cache_creation_input_tokens: 1,
				spend: 0.25,
				api_requests: 2,
				successful_requests: 1,
				failed_requests: 1,
				[entityField]: entityValue,
			};
			const { db } = makeMockDailyActivityDb(new Map([[table, [row]]]));
			const app = buildAuthedApp(makeConfig(), undefined, undefined, db);
			const res = await request(app).get(`${path}?start_date=2026-01-01&end_date=2026-01-31`);

			expect(res.status).toBe(200);
			expect(res.body.results).toHaveLength(1);
			expect(res.body.results[0]).toMatchObject({
				date: "2026-01-02",
				metrics: {
					spend: 0.25,
					prompt_tokens: 10,
					completion_tokens: 4,
					total_tokens: 14,
					api_requests: 2,
					successful_requests: 1,
					failed_requests: 1,
				},
			});
			expect(res.body.results[0].breakdown.entities[entityValue].metrics.spend).toBe(0.25);
			expect(res.body.results[0].breakdown.models["provider/model"].metrics.total_tokens).toBe(14);
			expect(res.body.metadata).toMatchObject({
				total_spend: 0.25,
				total_tokens: 14,
				total_api_requests: 2,
				total_successful_requests: 1,
				total_failed_requests: 1,
				total_pages: 1,
				has_more: false,
				page: 1,
			});
		});

		it("/user/daily/activity 应批量注入 key metadata 并生成所有 nested api_key_breakdown", async () => {
			const makeRow = (
				apiKey: string,
				model: string,
				spend: number,
				promptTokens: number,
				completionTokens: number,
			): DailyActivityTestRow => ({
				date: "2026-01-02",
				api_key: apiKey,
				model: model,
				model_group: "logical-model",
				custom_llm_provider: "provider",
				mcp_namespaced_tool_name: "server/tool",
				endpoint: "/v1/chat/completions",
				prompt_tokens: promptTokens,
				completion_tokens: completionTokens,
				cache_read_input_tokens: 3,
				cache_creation_input_tokens: 2,
				spend: spend,
				api_requests: 1,
				successful_requests: 1,
				failed_requests: 0,
				user_id: "user-1",
			});
			const rows = [
				makeRow("key-active", "model-a", 1, 10, 4),
				makeRow("key-active", "model-b", 2, 5, 1),
				makeRow("key-deleted", "model-a", 3, 7, 2),
				makeRow("key-unknown", "model-b", 4, 6, 3),
			];
			const activeKeys: DailyActivityKeyMetadataTestRow[] = [
				{ token: "key-active", keyAlias: "active-alias", keyName: "active-name", teamId: "active-team" },
			];
			const deletedKeys: DailyActivityKeyMetadataTestRow[] = [
				{
					token: "key-active",
					keyAlias: "deleted-must-not-win",
					keyName: "deleted-active-name",
					teamId: "deleted-active-team",
					deletedAt: new Date("2026-01-03T00:00:00.000Z"),
				},
				{
					token: "key-deleted",
					keyAlias: "latest-deleted-alias",
					keyName: "latest-deleted-name",
					teamId: "latest-deleted-team",
					deletedAt: new Date("2026-01-04T00:00:00.000Z"),
				},
				{
					token: "key-deleted",
					keyAlias: "older-deleted-alias",
					keyName: "older-deleted-name",
					teamId: "older-deleted-team",
					deletedAt: new Date("2026-01-01T00:00:00.000Z"),
				},
			];
			const { db, queryLog } = makeMockDailyActivityDb(new Map([[liteLLM_DailyUserSpend, rows]]), activeKeys, deletedKeys);
			const app = buildAuthedApp(makeConfig(), undefined, undefined, db);

			const res = await request(app).get("/user/daily/activity?start_date=2026-01-01&end_date=2026-01-31");

			expect(res.status).toBe(200);
			expect(queryLog.activeQueries).toBe(1);
			expect(queryLog.deletedQueries).toBe(1);
			expect(queryLog.deletedQueryValues).toEqual(expect.arrayContaining(["key-deleted", "key-unknown"]));
			expect(queryLog.deletedQueryValues).not.toContain("key-active");

			const breakdown = res.body.results[0].breakdown;
			const activeMetadata = { key_alias: "active-alias", key_name: "active-name", team_id: "active-team" };
			const deletedMetadata = {
				key_alias: "latest-deleted-alias",
				key_name: "latest-deleted-name",
				team_id: "latest-deleted-team",
			};
			const unknownMetadata = { key_alias: null, key_name: null, team_id: null };
			expect(breakdown.api_keys["key-active"]).toMatchObject({
				metrics: { spend: 3, prompt_tokens: 15, completion_tokens: 5, total_tokens: 20 },
				metadata: activeMetadata,
				api_key_breakdown: {},
			});
			expect(breakdown.api_keys["key-deleted"].metadata).toEqual(deletedMetadata);
			expect(breakdown.api_keys["key-unknown"].metadata).toEqual(unknownMetadata);

			for (const [dimension, value] of [
				["models", "model-a"],
				["model_groups", "logical-model"],
				["providers", "provider"],
				["mcp_servers", "server/tool"],
				["endpoints", "/v1/chat/completions"],
				["entities", "user-1"],
			] as const) {
				expect(breakdown[dimension][value].api_key_breakdown["key-active"].metadata).toEqual(activeMetadata);
				expect(breakdown[dimension][value].api_key_breakdown["key-active"].metrics.total_tokens).toBeGreaterThan(0);
			}
			expect(breakdown.models["model-a"].api_key_breakdown["key-deleted"]).toMatchObject({
				metrics: { spend: 3, prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
				metadata: deletedMetadata,
			});
			expect(breakdown.models["model-b"].api_key_breakdown["key-unknown"].metadata).toEqual(unknownMetadata);
			// prompt_tokens 已含 cache，total_tokens 只能是 prompt + completion，不能重复加 cache。
			expect(res.body.results[0].metrics).toMatchObject({
				prompt_tokens: 28,
				completion_tokens: 10,
				cache_read_input_tokens: 12,
				cache_creation_input_tokens: 8,
				total_tokens: 38,
			});
		});

		it("/user/daily/activity deleted metadata 查询失败应降级为 null 且不阻断", async () => {
			const row: DailyActivityTestRow = {
				date: "2026-01-02",
				api_key: "missing-key",
				model: "model-a",
				model_group: "logical-model",
				custom_llm_provider: "provider",
				mcp_namespaced_tool_name: "server/tool",
				endpoint: "/v1/chat/completions",
				prompt_tokens: 2,
				completion_tokens: 1,
				cache_read_input_tokens: 1,
				cache_creation_input_tokens: 1,
				spend: 0.1,
				api_requests: 1,
				successful_requests: 1,
				failed_requests: 0,
				user_id: "user-1",
			};
			const { db, queryLog } = makeMockDailyActivityDb(new Map([[liteLLM_DailyUserSpend, [row]]]), [], [], true);
			const app = buildAuthedApp(makeConfig(), undefined, undefined, db);

			const res = await request(app).get("/user/daily/activity?start_date=2026-01-01&end_date=2026-01-31");

			expect(res.status).toBe(200);
			expect(queryLog.activeQueries).toBe(1);
			expect(queryLog.deletedQueries).toBe(1);
			expect(res.body.results[0].breakdown.api_keys["missing-key"].metadata).toEqual({
				key_alias: null,
				key_name: null,
				team_id: null,
			});
		});

		it("/user/daily/activity/aggregated 应返回单页聚合响应", async () => {
			const row: DailyActivityTestRow = {
				date: "2026-01-02",
				api_key: "key-hash",
				model: "provider/model",
				model_group: null,
				custom_llm_provider: "provider",
				mcp_namespaced_tool_name: null,
				endpoint: null,
				prompt_tokens: 2,
				completion_tokens: 1,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
				spend: 0.1,
				api_requests: 1,
				successful_requests: 1,
				failed_requests: 0,
				user_id: "user-1",
			};
			const { db } = makeMockDailyActivityDb(new Map([[liteLLM_DailyUserSpend, [row]]]));
			const app = buildAuthedApp(makeConfig(), undefined, undefined, db);
			const res = await request(app).get("/user/daily/activity/aggregated?start_date=2026-01-01&end_date=2026-01-31");
			expect(res.status).toBe(200);
			expect(res.body.results).toHaveLength(1);
			expect(res.body.metadata).toMatchObject({ page: 1, total_pages: 1, has_more: false, total_spend: 0.1 });
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

		it("session 查询仅返回非敏感身份，logout 校验 CSRF 并撤销 DB session", async () => {
			const app = express();
			app.use(express.json());
			const router = express.Router();
			const authMiddleware: express.RequestHandler = (req, _res, next) => {
				req.auth = {
					api_key: "stored-session-hash",
					token: "stored-session-hash",
					user_id: "default_user_id",
					user_role: "proxy_admin",
					metadata: {
						webui_session: true,
						user_id: "default_user_id",
						user_role: "proxy_admin",
						login_method: "username_password",
						premium_user: true,
					},
				};
				next();
			};
			const authRepository = { revokeVerificationTokenByHash: jest.fn().mockResolvedValue(undefined) };
			registerLoginRoutes(router, makeConfig(), {} as never, authMiddleware, webUiCsrfProtection, authRepository as never);
			app.use(router);

			const sessionResponse = await request(app).get("/auth/session");
			expect(sessionResponse.status).toBe(200);
			expect(sessionResponse.body).toMatchObject({ authenticated: true, user_role: "proxy_admin" });
			expect(sessionResponse.body).not.toHaveProperty("key");
			expect(sessionResponse.body).not.toHaveProperty("jti");

			const logoutResponse = await request(app)
				.post("/auth/logout")
				.set("Cookie", "token=session; litellm_csrf_token=csrf-value")
				.set("x-litellm-csrf-token", "csrf-value");
			expect(logoutResponse.status).toBe(200);
			expect(authRepository.revokeVerificationTokenByHash).toHaveBeenCalledWith("stored-session-hash");
			const clearedCookies = logoutResponse.headers["set-cookie"] as unknown as string[];
			expect(clearedCookies.some((cookie) => cookie.startsWith("token=;"))).toBe(true);
			expect(clearedCookies.some((cookie) => cookie.startsWith("litellm_csrf_token=;"))).toBe(true);
		});

		it("cookie session 应为 HttpOnly，并让 JWT 与 DB 使用同一过期时间且不携带 API key", async () => {
			process.env.LITELLM_UI_SESSION_DURATION = "30m";
			const app = buildPublicApp(makeConfig());
			const beforeLoginSeconds = Math.floor(Date.now() / 1000);
			const res = await request(app).post("/v2/login").send({ username: "admin", password: "sk-test-master-key" });
			delete process.env.LITELLM_UI_SESSION_DURATION;

			expect(res.status).toBe(200);
			const setCookie = res.headers["set-cookie"];
			const cookies = Array.isArray(setCookie) ? setCookie : [String(setCookie)];
			const tokenCookie = cookies.find((cookie) => cookie.startsWith("token="));
			expect(tokenCookie).toContain("HttpOnly");
			expect(tokenCookie).toContain("SameSite=Lax");
			const csrfCookie = cookies.find((cookie) => cookie.startsWith("litellm_csrf_token="));
			expect(csrfCookie).toBeDefined();
			expect(csrfCookie).not.toContain("HttpOnly");

			const tokenValue = tokenCookie!.split(";")[0]!.slice("token=".length);
			const payloadSegment = tokenValue.split(".")[1]!;
			const payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")) as Record<string, unknown>;
			expect(payload.key).toBeUndefined();
			expect(payload.iat).toEqual(expect.any(Number));
			expect(payload.exp).toEqual(expect.any(Number));
			expect(payload.jti).toEqual(expect.any(String));
			expect(payload.webui_session).toBe(true);
			expect((payload.exp as number) - (payload.iat as number)).toBe(30 * 60);
			expect(payload.iat as number).toBeGreaterThanOrEqual(beforeLoginSeconds);

			const inserted = (app as unknown as { __inserted: Array<Record<string, unknown>> }).__inserted;
			expect(inserted).toHaveLength(1);
			expect(inserted[0]!.token).toMatch(/^[0-9a-f]{64}$/);
			expect(inserted[0]!.token).not.toBe(payload.jti);
			expect((inserted[0]!.expires as Date).getTime()).toBe((payload.exp as number) * 1000);
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
		it("config 有 modelList 时应返回非空 data 与 Python 分页字段（无 TS 别名）", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, makeTestDeployments());
			const res = await request(app).get("/v2/model/info");
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body.data)).toBe(true);
			expect(res.body.data.length).toBeGreaterThan(0);
			// 顶层键集与 Python _paginate_models_response 完全一致
			expect(Object.keys(res.body).sort()).toEqual(["current_page", "data", "size", "total_count", "total_pages"]);
			expect(typeof res.body.total_count).toBe("number");
			expect(typeof res.body.current_page).toBe("number");
			expect(typeof res.body.total_pages).toBe("number");
			expect(typeof res.body.size).toBe("number");
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
			// Python LiteLLM_Params 默认 false 的三个布尔开关必须始终存在
			expect(item.litellm_params.merge_reasoning_content_in_choices).toBe(false);
			expect(item.litellm_params.use_in_pass_through).toBe(false);
			expect(item.litellm_params.use_litellm_proxy).toBe(false);
			expect(item.model_info.id).toBe("openai/gpt-4o-primary");
			expect(item.model_info.mode).toBe("chat");
			expect(item.model_info.litellm_provider).toBe("openai");
		});

		it("model_info 应补齐 Python 73 键全集（缺省 null，含 key 与 supported_openai_params）+ TS 扩展 fallbacks", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, makeTestDeployments());
			const res = await request(app).get("/v2/model/info");
			expect(res.status).toBe(200);
			const expectedKeys = [
				"key",
				"max_tokens",
				"max_input_tokens",
				"max_output_tokens",
				"input_cost_per_token",
				"input_cost_per_token_flex",
				"input_cost_per_token_priority",
				"cache_creation_input_token_cost",
				"cache_creation_input_token_cost_above_200k_tokens",
				"cache_read_input_token_cost",
				"cache_read_input_token_cost_above_200k_tokens",
				"cache_read_input_token_cost_above_272k_tokens",
				"cache_read_input_token_cost_flex",
				"cache_read_input_token_cost_priority",
				"cache_creation_input_token_cost_above_1hr",
				"input_cost_per_character",
				"input_cost_per_token_above_128k_tokens",
				"input_cost_per_token_above_200k_tokens",
				"input_cost_per_token_above_272k_tokens",
				"input_cost_per_query",
				"input_cost_per_second",
				"input_cost_per_audio_token",
				"input_cost_per_image_token",
				"input_cost_per_image",
				"input_cost_per_audio_per_second",
				"input_cost_per_video_per_second",
				"input_cost_per_token_batches",
				"output_cost_per_token_batches",
				"output_cost_per_token",
				"output_cost_per_token_flex",
				"output_cost_per_token_priority",
				"output_cost_per_audio_token",
				"output_cost_per_character",
				"output_cost_per_reasoning_token",
				"output_cost_per_token_above_128k_tokens",
				"output_cost_per_character_above_128k_tokens",
				"output_cost_per_token_above_200k_tokens",
				"output_cost_per_token_above_272k_tokens",
				"output_cost_per_second",
				"output_cost_per_video_per_second",
				"output_cost_per_image",
				"output_cost_per_image_token",
				"output_vector_size",
				"citation_cost_per_token",
				"tiered_pricing",
				"litellm_provider",
				"mode",
				"supports_system_messages",
				"supports_response_schema",
				"supports_vision",
				"supports_function_calling",
				"supports_tool_choice",
				"supports_assistant_prefill",
				"supports_prompt_caching",
				"supports_audio_input",
				"supports_audio_output",
				"supports_pdf_input",
				"supports_embedding_image_input",
				"supports_native_streaming",
				"supports_web_search",
				"supports_url_context",
				"supports_reasoning",
				"supports_computer_use",
				"search_context_cost_per_query",
				"tpm",
				"rpm",
				"ocr_cost_per_page",
				"annotation_cost_per_page",
				"provider_specific_entry",
				"uses_embed_content",
				"supported_openai_params",
				"id",
				"db_model",
				// TS 扩展键（批次 D）：WebUI Fallback 列数据源，按 model_group 反查 Router 当前配置
				"fallbacks",
			].sort();
			for (const item of res.body.data) {
				// config model_info 中的额外键（如测试 deployment 的自定义字段）不允许出现，
				// 因而每个元素的键集必须恰好等于 73 键全集 + TS 扩展 fallbacks
				expect(Object.keys(item.model_info).sort()).toEqual(expectedKeys);
				expect(item.model_info.db_model).toBe(false);
				expect(Array.isArray(item.model_info.fallbacks)).toBe(true);
				expect(typeof item.model_info.id).toBe("string");
				expect(typeof item.model_info.key).toBe("string");
				// anthropic/claude-3-7-sonnet 按 Python 规则应附带 thinking/reasoning_effort
				expect(Array.isArray(item.model_info.supported_openai_params)).toBe(true);
			}
			const claude = (res.body.data as Array<{ model_name: string; model_info: { supported_openai_params: string[] } }>).find(
				(x) => x.model_name === "claude-3-7-sonnet",
			);
			expect(claude?.model_info.supported_openai_params).toContain("thinking");
			expect(claude?.model_info.supported_openai_params).toContain("reasoning_effort");
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

		it("每项应对齐 Python 22 键结构（supports_* 布尔、health_* null、is_public_model_group false）", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, makeTestDeployments());
			const res = await request(app).get("/model_group/info");
			expect(res.status).toBe(200);
			const expectedKeys = [
				"model_group",
				"providers",
				"max_input_tokens",
				"max_output_tokens",
				"input_cost_per_token",
				"output_cost_per_token",
				"input_cost_per_pixel",
				"mode",
				"tpm",
				"rpm",
				"supports_parallel_function_calling",
				"supports_vision",
				"supports_web_search",
				"supports_url_context",
				"supports_reasoning",
				"supports_function_calling",
				"supported_openai_params",
				"configurable_clientside_auth_params",
				"is_public_model_group",
				"health_status",
				"health_response_time",
				"health_checked_at",
			].sort();
			expect(res.body.data.length).toBeGreaterThan(0);
			for (const item of res.body.data) {
				expect(Object.keys(item).sort()).toEqual(expectedKeys);
				expect(typeof item.supports_parallel_function_calling).toBe("boolean");
				expect(typeof item.supports_vision).toBe("boolean");
				expect(typeof item.supports_web_search).toBe("boolean");
				expect(typeof item.supports_url_context).toBe("boolean");
				expect(typeof item.supports_reasoning).toBe("boolean");
				expect(typeof item.supports_function_calling).toBe("boolean");
				expect(Array.isArray(item.supported_openai_params)).toBe(true);
				expect(item.configurable_clientside_auth_params).toBeNull();
				expect(item.is_public_model_group).toBe(false);
				expect(item.health_status).toBeNull();
				expect(item.health_response_time).toBeNull();
				expect(item.health_checked_at).toBeNull();
			}
		});

		it("应按组聚合 supports_*（任一 deployment 支持则 true）并取成本 max", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, makeTestDeployments());
			const res = await request(app).get("/model_group/info");
			const gpt4o = (
				res.body.data as Array<{
					model_group: string;
					supports_function_calling: boolean;
					supports_vision: boolean;
					input_cost_per_token: number | null;
					output_cost_per_token: number | null;
					tpm: number | null;
					rpm: number | null;
					providers: string[];
				}>
			).find((x) => x.model_group === "gpt-4o");
			expect(gpt4o).toBeDefined();
			if (!gpt4o) {
				throw new Error("expected gpt-4o model group");
			}
			// 首个 deployment config 声明 supports_function_calling/supports_vision
			expect(gpt4o.supports_function_calling).toBe(true);
			expect(gpt4o.supports_vision).toBe(true);
			// 成本取 cost map（gpt-4o 条目）推导值，对齐 Python get_deployment_model_info
			expect(gpt4o.input_cost_per_token).toBe(0.0000025);
			expect(gpt4o.output_cost_per_token).toBe(0.00001);
			// tpm/rpm 为组内 deployment 之和（Python total_tpm/total_rpm 语义）
			expect(gpt4o.tpm).toBe(15000);
			expect(gpt4o.rpm).toBe(150);
			expect(gpt4o.providers).toEqual(["openai"]);
		});

		it("无 deployment 时应返回 { data: [] }", async () => {
			const config = makeConfig();
			const app = buildAuthedApp(config, []);
			const res = await request(app).get("/model_group/info");
			expect(res.status).toBe(200);
			expect(res.body.data).toEqual([]);
		});
	});

	describe("/get/config/callbacks", () => {
		it("非 proxy_admin 不得访问", async () => {
			const app = buildAuthedApp(makeConfig(), undefined, { api_key: "sk-user-key" });
			const res = await request(app).get("/get/config/callbacks");

			expect(res.status).toBe(403);
		});

		it("master key 会话（user_role=proxy_admin 且无 team_id）应可访问", async () => {
			// UserApiKeyAuth master key 直通分支产出的 auth 形状（user_role=proxy_admin、无 team_id）
			const app = buildAuthedApp(makeConfig(), undefined, { api_key: "sk-master-key", user_role: "proxy_admin" });
			const res = await request(app).get("/get/config/callbacks");

			expect(res.status).toBe(200);
			expect(res.body.status).toBe("success");
		});

		it("应返回真实 router_settings 与 litellm_settings 回调字段", async () => {
			const config = {
				...makeConfig(),
				routerSettingsRaw: {
					routing_strategy: "latency-based-routing",
					num_retries: 2,
					redis_password: "must-not-leak",
				},
				litellmSettingsRaw: {
					success_callback: ["langfuse"],
					failure_callback: ["slack"],
					callbacks: ["prometheus"],
					service_callbacks: ["health_check"],
				},
			} as ServiceConfig;
			const app = buildAuthedApp(config);

			const res = await request(app).get("/get/config/callbacks");

			expect(res.status).toBe(200);
			expect(res.body.status).toBe("success");
			// router_settings 对齐 PY llm_router.get_settings() 键集（redis_password 等非标准键不透出）
			expect(res.body.router_settings).toMatchObject({
				routing_strategy: "latency-based-routing",
				num_retries: 2,
			});
			expect(res.body.router_settings).not.toHaveProperty("redis_password");
			// callbacks 对齐 PY get_config 的 _data_to_return 数组形态 [{name, variables, type}]
			expect(res.body.callbacks).toEqual([
				{ name: "langfuse", variables: expect.objectContaining({}), type: "success" },
				{ name: "slack", variables: expect.objectContaining({}), type: "failure" },
				{ name: "prometheus", variables: expect.objectContaining({}), type: "success_and_failure" },
			]);
			expect(res.body.available_callbacks.langfuse).toMatchObject({
				litellm_callback_name: "langfuse",
				ui_callback_name: "Langfuse",
			});
		});
	});

	describe("/config/field/info", () => {
		it("非 proxy_admin 不得访问", async () => {
			const app = buildAuthedApp(makeConfig(), undefined, { api_key: "sk-user-key" });
			const res = await request(app).get("/config/field/info?field_name=store_model_in_db");

			expect(res.status).toBe(403);
		});

		it("支持 field_name/field/param 并只返回白名单字段", async () => {
			const config = {
				...makeConfig({}, { store_model_in_db: true }),
				routerSettingsRaw: { num_retries: 3 },
			} as ServiceConfig;
			const app = buildAuthedApp(config);

			const byFieldName = await request(app).get("/config/field/info?field_name=store_model_in_db");
			const byField = await request(app).get("/config/field/info?field=num_retries");
			const byParam = await request(app).get("/config/field/info?param=missing_allowed_field");

			expect(byFieldName.status).toBe(200);
			expect(byFieldName.body).toEqual({ field_name: "store_model_in_db", field_value: true });
			expect(byField.status).toBe(200);
			expect(byField.body).toEqual({ field_name: "num_retries", field_value: 3 });
			expect(byParam.status).toBe(403);
		});

		it("敏感字段不得泄漏", async () => {
			const app = buildAuthedApp(makeConfig());
			const res = await request(app).get("/config/field/info?field_name=master_key");

			expect(res.status).toBe(200);
			expect(res.body).toEqual({ field_name: "master_key", field_value: null });
			expect(JSON.stringify(res.body)).not.toContain("sk-test-master-key");
		});
	});

	describe("/model/cost_map/source", () => {
		it("非 proxy_admin 不得访问", async () => {
			const app = buildAuthedApp(makeConfig(), undefined, { api_key: "sk-user-key" });
			const res = await request(app).get("/model/cost_map/source");

			expect(res.status).toBe(403);
		});

		it("master key 会话（user_role=proxy_admin 且无 team_id）应可访问", async () => {
			const app = buildAuthedApp(makeConfig(), undefined, { api_key: "sk-master-key", user_role: "proxy_admin" });
			const res = await request(app).get("/model/cost_map/source");

			expect(res.status).toBe(200);
			expect(typeof res.body.model_count).toBe("number");
		});

		it("返回注入服务当前 snapshot 的元数据，而非静态 config", async () => {
			const costMapService = makeCostMapService(JSON.stringify({ dynamic: { input_cost_per_token: 1, output_cost_per_token: 2 } }));
			const app = buildAuthedApp(makeConfig(), undefined, undefined, undefined, undefined, costMapService);

			const res = await request(app).get("/model/cost_map/source");

			expect(res.status).toBe(200);
			expect(res.body).toMatchObject({
				source: "local",
				url: null,
				is_env_forced: true,
				fallback_reason: null,
				model_count: 1,
			});
		});

		it("schedule、status、cancel 和 reload 均委托给价格服务", async () => {
			const costMapService = makeCostMapService(JSON.stringify({ dynamic: { input_cost_per_token: 1, output_cost_per_token: 2 } }));
			const app = buildAuthedApp(makeConfig(), undefined, undefined, undefined, undefined, costMapService);

			expect((await request(app).post("/schedule/model_cost_map_reload?hours=2")).body).toMatchObject({
				success: true,
				scheduled: true,
				hours: 2,
			});
			expect((await request(app).get("/schedule/model_cost_map_reload/status")).body).toMatchObject({
				scheduled: true,
				hours: 2,
			});
			expect((await request(app).post("/reload/model_cost_map")).body).toEqual({
				status: "success",
				models_count: 1,
				source: "local",
				timestamp: expect.any(String),
				fallback_reason: null,
			});
			expect((await request(app).delete("/schedule/model_cost_map_reload")).body).toEqual({
				success: true,
				scheduled: false,
				hours: null,
				next_reload_at: null,
			});
		});
	});

	it("/v2/model/info 从当前 snapshot 推导价格，显式 model_info 覆盖优先", async () => {
		const costMapService = makeCostMapService(
			JSON.stringify({ dynamic: { input_cost_per_token: 1, output_cost_per_token: 2, max_input_tokens: 100 } }),
		);
		const deployments: Deployment[] = [
			{
				model_name: "dynamic",
				litellm_params: { model: "dynamic" },
				model_info: { id: "dynamic", input_cost_per_token: 9 },
			},
		];
		const app = buildAuthedApp(makeConfig(), deployments, undefined, undefined, undefined, costMapService);

		const res = await request(app).get("/v2/model/info");

		expect(res.status).toBe(200);
		expect(res.body.data[0].model_info).toMatchObject({ input_cost_per_token: 9, output_cost_per_token: 2, max_input_tokens: 100 });
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

describe("批次 C — DB 配置进运行时", () => {
	it("/config/update 写 router_settings 后立即热应用 Router（fallback 链切换，批次 C1）", async () => {
		const { db } = makeMockConfigDb();
		await dbConfigProvider.initialize(db as never);
		const litellmRouter = new LiteLLMRouter({
			model_list: [{ model_name: "gpt-4o", litellm_params: { model: "openai/gpt-4o" } }],
			routing_strategy: RoutingStrategyName.SimpleShuffle,
			num_retries: 0,
		});
		const app = buildAuthedApp(makeConfig(), undefined, undefined, db, litellmRouter);

		expect(litellmRouter.getNextFallback("gpt-4o", 0)).toBeNull();
		const res = await request(app)
			.post("/config/update")
			.send({ router_settings: { fallbacks: [{ "gpt-4o": ["gpt-4o-mini"] }] } });

		expect(res.status).toBe(200);
		expect(litellmRouter.getNextFallback("gpt-4o", 0)).toBe("gpt-4o-mini");
	});

	it("/router/settings current_values 反映 DB router_settings 覆盖（批次 C4）", async () => {
		const { db } = makeMockConfigDb({ router_settings: { num_retries: 9, routing_strategy: "least-busy" } });
		await dbConfigProvider.initialize(db as never);
		const app = buildAuthedApp(makeConfig());

		const res = await request(app).get("/router/settings");

		expect(res.status).toBe(200);
		expect(res.body.current_values.num_retries).toBe(9);
		expect(res.body.current_values.routing_strategy).toBe("least-busy");
		const numRetriesField = (res.body.fields as Array<{ field_name: string; field_value: unknown }>).find(
			(field) => field.field_name === "num_retries",
		);
		expect(numRetriesField?.field_value).toBe(9);
	});

	it("/get/config/callbacks router_settings 反映 DB 覆盖（批次 C4）", async () => {
		const { db } = makeMockConfigDb({ router_settings: { num_retries: 6 } });
		await dbConfigProvider.initialize(db as never);
		const app = buildAuthedApp(makeConfig());

		const res = await request(app).get("/get/config/callbacks");

		expect(res.status).toBe(200);
		expect(res.body.router_settings.num_retries).toBe(6);
	});
});

describe("批次 D — /v2/model/info fallbacks 注入", () => {
	const buildRouterWithFallbacks = (): LiteLLMRouter =>
		new LiteLLMRouter({
			model_list: [
				{ model_name: "gpt-4o", litellm_params: { model: "openai/gpt-4o" } },
				{ model_name: "gpt-4o-mini", litellm_params: { model: "openai/gpt-4o-mini" } },
			],
			routing_strategy: RoutingStrategyName.SimpleShuffle,
			num_retries: 0,
			fallbacks: [{ "gpt-4o": ["gpt-4o-mini", "claude-3-7-sonnet"] }],
		});

	it("每项 model_info 注入当前 fallback 链；无配置的 model_group 为空数组", async () => {
		const app = buildAuthedApp(makeConfig(), undefined, undefined, undefined, buildRouterWithFallbacks());

		const res = await request(app).get("/v2/model/info");

		expect(res.status).toBe(200);
		const fallbacksByName = new Map<string, string[]>(
			(res.body.data as Array<{ model_name: string; model_info: { fallbacks: string[] } }>).map((item) => [
				item.model_name,
				item.model_info.fallbacks,
			]),
		);
		expect(fallbacksByName.get("gpt-4o")).toEqual(["gpt-4o-mini", "claude-3-7-sonnet"]);
		expect(fallbacksByName.get("gpt-4o-mini")).toEqual([]);
	});

	it("fallbacks 热更新后反映最新链（Router.updateSettings → getFallbacks）", async () => {
		const litellmRouter = buildRouterWithFallbacks();
		const app = buildAuthedApp(makeConfig(), undefined, undefined, undefined, litellmRouter);

		litellmRouter.updateSettings({ fallbacks: [{ "gpt-4o": ["gpt-4o-mini"] }] });
		const res = await request(app).get("/v2/model/info");

		expect(res.status).toBe(200);
		const gpt4oItem = (res.body.data as Array<{ model_name: string; model_info: { fallbacks: string[] } }>).find(
			(item) => item.model_name === "gpt-4o",
		);
		expect(gpt4oItem?.model_info.fallbacks).toEqual(["gpt-4o-mini"]);
	});

	it("/v1/model/info 同样注入 fallbacks", async () => {
		const app = buildAuthedApp(makeConfig(), undefined, undefined, undefined, buildRouterWithFallbacks());

		const res = await request(app).get("/v1/model/info?model_id=gpt-4o");

		expect(res.status).toBe(200);
		expect(res.body.data[0].model_info.fallbacks).toEqual(["gpt-4o-mini", "claude-3-7-sonnet"]);
	});

	describe("websearch_override_target_model General Settings", () => {
		const modelName = "websearch-model";
		const aliasName = "websearch-alias";
		const providerModel = "anthropic/provider-model";
		const deploymentId = "websearch-deployment-id";
		const buildWebSearchRouter = () =>
			new LiteLLMRouter({
				model_list: [{ model_name: modelName, litellm_params: { model: providerModel }, model_info: { id: deploymentId } }],
				routing_strategy: RoutingStrategyName.SimpleShuffle,
				num_retries: 0,
				model_group_alias: { [aliasName]: modelName },
			});

		afterEach(async () => {
			await dbConfigProvider.initialize(makeMockConfigDb().db as never);
		});

		it("仅公开 Router 当前逻辑模型名和 alias key", async () => {
			const app = buildAuthedApp(makeConfig(), undefined, undefined, undefined, buildWebSearchRouter());
			const res = await request(app).get("/config/websearch_override_target_model/options").expect(200);

			expect(res.body).toEqual({
				data: [
					{ model_name: aliasName, type: "alias" },
					{ model_name: modelName, type: "model" },
				],
			});
			expect(JSON.stringify(res.body)).not.toContain(providerModel);
			expect(JSON.stringify(res.body)).not.toContain(deploymentId);
		});

		it("只持久化候选模型或 alias，拒绝任意文本、provider model、deployment ID 和缺失 Router", async () => {
			const { db, store } = makeMockConfigDb();
			await dbConfigProvider.initialize(db as never);
			const app = buildAuthedApp(makeConfig(), undefined, undefined, db, buildWebSearchRouter());

			for (const validValue of [modelName, aliasName]) {
				await request(app)
					.post("/config/field/update")
					.send({ field_name: "websearch_override_target_model", field_value: validValue, config_type: "general_settings" })
					.expect(200);
				expect(store.get("general_settings")).toEqual({ websearch_override_target_model: validValue });
			}

			for (const invalidValue of ["arbitrary", providerModel, deploymentId, "", "   "]) {
				await request(app)
					.post("/config/field/update")
					.send({ field_name: "websearch_override_target_model", field_value: invalidValue, config_type: "general_settings" })
					.expect(400);
				expect(store.get("general_settings")).toEqual({ websearch_override_target_model: aliasName });
			}

			const missingRouterApp = buildAuthedApp(makeConfig(), undefined, undefined, db);
			await request(missingRouterApp)
				.post("/config/field/update")
				.send({ field_name: "websearch_override_target_model", field_value: modelName, config_type: "general_settings" })
				.expect(400);
			expect(store.get("general_settings")).toEqual({ websearch_override_target_model: aliasName });
		});

		it("显示 YAML 值、持久化 DB 覆盖并在删除后回退 YAML", async () => {
			const { db, store } = makeMockConfigDb();
			await dbConfigProvider.initialize(db as never);
			const app = buildAuthedApp(
				makeConfig({}, { websearch_override_target_model: modelName }),
				undefined,
				undefined,
				db,
				buildWebSearchRouter(),
			);

			const initial = await request(app).get("/config/list?config_type=general_settings").expect(200);
			const findField = (fields: Array<{ field_name: string; field_value: unknown; stored_in_db: boolean | null }>) =>
				fields.find((field) => field.field_name === "websearch_override_target_model");
			expect(findField(initial.body)).toMatchObject({ field_value: modelName, stored_in_db: false });

			await request(app)
				.post("/config/field/update")
				.send({ field_name: "websearch_override_target_model", field_value: aliasName, config_type: "general_settings" })
				.expect(200);
			expect(store.get("general_settings")).toEqual({ websearch_override_target_model: aliasName });

			await request(app)
				.post("/config/field/delete")
				.send({ field_name: "websearch_override_target_model", config_type: "general_settings" })
				.expect(200);
			const reset = await request(app).get("/config/list?config_type=general_settings").expect(200);
			expect(findField(reset.body)).toMatchObject({ field_value: modelName, stored_in_db: false });
		});
	});
});
