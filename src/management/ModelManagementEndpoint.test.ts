/**
 * ModelManagementEndpoint 写操作契约测试
 *
 * 锁定 Python LiteLLM model_management_endpoints 行为：
 * - /model/new 返回完整模型行（8 键），litellm_params 补齐 pydantic 缺省布尔字段，model_info 写入 id/db_model
 * - /model/update 必须提供 model_info.id，仅合并更新 litellm_params，返回完整模型行
 * - /model/delete 接受 { id }，返回 { message: "Model: <id> deleted successfully" }
 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/management_endpoints/model_management_endpoints.py
 */
import express from "express";
import request from "supertest";
import { createModelManagementRoutes } from "./ModelManagementEndpoint";
import { Router as LiteLLMRouter } from "../router/Router";
import { RoutingStrategyName } from "../types/router";

const MODEL_ROW = {
	model_id: "model-1",
	model_name: "m",
	litellm_params: { model: "gpt-4", use_litellm_proxy: false, use_in_pass_through: false, merge_reasoning_content_in_choices: false },
	model_info: { id: "model-1", db_model: false },
	created_at: new Date("2026-01-01T00:00:00.000Z"),
	created_by: "default_user_id",
	updated_at: new Date("2026-01-01T00:00:00.000Z"),
	updated_by: "default_user_id",
};

const PYTHON_MODEL_FIELDS = [
	"model_id",
	"model_name",
	"litellm_params",
	"model_info",
	"created_at",
	"created_by",
	"updated_at",
	"updated_by",
];

function makeApp(
	options: {
		existing?: Record<string, unknown>[];
		inserted?: Record<string, unknown>[];
		deletedRowCount?: number;
		litellmRouter?: LiteLLMRouter;
		updated?: Record<string, unknown>[];
		updateReturning?: Record<string, unknown>[];
	} = {},
): express.Express {
	const existing = options.existing ?? [];
	const app = express();
	app.use(express.json());
	const router = express.Router();
	const db = {
		select: () => ({
			from: () =>
				Object.assign(Promise.resolve(existing), {
					where: () => ({
						limit: (n: number) => Promise.resolve(existing.slice(0, n)),
					}),
				}),
		}),
		insert: () => ({
			values: (values: Record<string, unknown>) => {
				options.inserted?.push(values);
				return {
					returning: () =>
						Promise.resolve([
							{
								created_at: MODEL_ROW.created_at,
								updated_at: MODEL_ROW.updated_at,
								...values,
							},
						]),
				};
			},
		}),
		update: () => ({
			set: (values: Record<string, unknown>) => {
				options.updated?.push(values);
				return {
					where: () => ({
						returning: () => Promise.resolve(options.updateReturning ?? [{ ...(existing[0] ?? MODEL_ROW), ...values }]),
					}),
				};
			},
		}),
		delete: () => ({
			where: () => Promise.resolve({ rowCount: options.deletedRowCount ?? 1 }),
		}),
	};
	createModelManagementRoutes(router, db as never, null, options.litellmRouter);
	app.use(router);
	return app;
}

describe("ModelManagementEndpoint /model/new 契约", () => {
	it("返回 8 键完整模型行；litellm_params 补缺省布尔字段；model_info 写 id/db_model；model_id 取 model_info.id", async () => {
		const inserted: Record<string, unknown>[] = [];
		const app = makeApp({ inserted: inserted });

		const res = await request(app)
			.post("/model/new")
			.send({ model_name: "m", litellm_params: { model: "gpt-4" }, model_info: { id: "custom-id", description: "d" } });

		expect(res.status).toBe(200);
		expect(Object.keys(res.body).sort()).toEqual([...PYTHON_MODEL_FIELDS].sort());
		expect(res.body.model_id).toBe("custom-id");
		expect(res.body.created_by).toBe("default_user_id");
		expect(res.body.litellm_params.use_litellm_proxy).toBe(false);
		expect(res.body.litellm_params.use_in_pass_through).toBe(false);
		expect(res.body.litellm_params.merge_reasoning_content_in_choices).toBe(false);
		expect(res.body.model_info).toMatchObject({ id: "custom-id", db_model: false, description: "d" });
		expect(inserted[0]?.model_id).toBe("custom-id");
	});

	it("管理响应、落库与 Router 都保留完整编辑值", async () => {
		const inserted: Record<string, unknown>[] = [];
		const litellmRouter = new LiteLLMRouter({ model_list: [], routing_strategy: RoutingStrategyName.SimpleShuffle, num_retries: 0 });
		const app = makeApp({ inserted: inserted, litellmRouter: litellmRouter });
		const secret = "sk-new-secret";

		const res = await request(app)
			.post("/model/new")
			.send({
				model_name: "secure-model",
				litellm_params: { model: "openai/gpt-4o", api_key: secret, extra_headers: { Authorization: "Bearer nested-secret" } },
				model_info: { id: "secure-model-1", password: "model-info-secret" },
			});

		expect(res.status).toBe(200);
		expect(res.body.litellm_params.api_key).toBe(secret);
		expect(res.body.litellm_params.extra_headers.Authorization).toBe("Bearer nested-secret");
		expect(res.body.model_info.password).toBe("model-info-secret");
		expect((inserted[0]?.litellm_params as Record<string, unknown>).api_key).toBe(secret);
		expect(litellmRouter.getDeployment("secure-model-1")?.litellm_params.api_key).toBe(secret);
	});

	it("model_info 缺省时自动生成 uuid model_id", async () => {
		const app = makeApp({});

		const res = await request(app)
			.post("/model/new")
			.send({ model_name: "m", litellm_params: { model: "gpt-4" } });

		expect(res.status).toBe(200);
		expect(res.body.model_id).toMatch(/^[0-9a-f]{8}-/);
		expect(res.body.model_info).toMatchObject({ id: res.body.model_id, db_model: false });
	});

	it("内置 CLIProxy 模型不落库 deployment credentials 或 endpoint overrides", async () => {
		const inserted: Record<string, unknown>[] = [];
		const app = makeApp({ inserted });

		const res = await request(app)
			.post("/model/new")
			.send({
				model_name: "codex",
				litellm_params: {
					model: "gpt-5.4",
					custom_llm_provider: "codex-subscription",
					litellm_credential_name: "legacy-cli-proxy",
					credential_name: "legacy-cli-proxy",
					api_base: "http://legacy.example",
					api_key: "legacy-secret",
				},
			});

		expect(res.status).toBe(200);
		expect(res.body.litellm_params).toMatchObject({
			model: "gpt-5.4",
			custom_llm_provider: "codex-subscription",
		});
		for (const field of ["litellm_credential_name", "credential_name", "api_base", "api_key"]) {
			expect(inserted[0]?.litellm_params as Record<string, unknown>).not.toHaveProperty(field);
		}
	});
});

describe("ModelManagementEndpoint raw model row", () => {
	it("returns every persisted column and leaves API keys unmasked", async () => {
		const row = {
			...MODEL_ROW,
			litellm_params: { ...MODEL_ROW.litellm_params, api_key: "sk-database-secret", custom_field: "preserved" },
			model_info: { ...MODEL_ROW.model_info, private_metadata: { source: "database" } },
		};
		const app = makeApp({ existing: [row] });

		const response = await request(app).get("/model/model-1/raw");

		expect(response.status).toBe(200);
		expect(response.body.litellm_params.api_key).toBe("sk-database-secret");
		expect(response.body.litellm_params.custom_field).toBe("preserved");
		expect(response.body.model_info.private_metadata).toEqual({ source: "database" });
		expect(Object.keys(response.body).sort()).toEqual([...PYTHON_MODEL_FIELDS].sort());
	});
});

describe("ModelManagementEndpoint /model/update 契约", () => {
	const NESTED_MODEL_ROW = {
		...MODEL_ROW,
		model_name: "old-name",
		litellm_params: {
			...MODEL_ROW.litellm_params,
			api_base: "https://old.example",
			extra_body: { keep: 1, remove: 2 },
		},
		model_info: { id: "model-1", db_model: false, description: "old", nested: { keep: 1, remove: 2 } },
	};

	it.each([
		["POST", "/model/update", { model_info: { id: "model-1" }, litellm_params: { api_key: "sk-rotated-secret" } }],
		["PATCH", "/model/model-1/update", { litellm_params: { api_key: "sk-rotated-secret" } }],
	] as const)("%s 更新响应、DB 与 Router 都使用真实值", async (method, path, body) => {
		const updated: Record<string, unknown>[] = [];
		const litellmRouter = new LiteLLMRouter({ model_list: [], routing_strategy: RoutingStrategyName.SimpleShuffle, num_retries: 0 });
		const existing = {
			...NESTED_MODEL_ROW,
			litellm_params: {
				...NESTED_MODEL_ROW.litellm_params,
				api_key: "sk-old-secret",
				input_cost_per_token: 0.000_002_5,
				output_cost_per_token: 0.000_01,
			},
		};
		litellmRouter.addDeployment({
			model_name: existing.model_name,
			litellm_params: existing.litellm_params,
			model_info: existing.model_info as never,
		});
		const app = makeApp({ existing: [existing], updated: updated, litellmRouter: litellmRouter });
		const res = method === "POST" ? await request(app).post(path).send(body) : await request(app).patch(path).send(body);

		expect(res.status).toBe(200);
		expect(res.body.litellm_params.api_key).toBe("sk-rotated-secret");
		expect(res.body.litellm_params.input_cost_per_token).toBe(0.000_002_5);
		expect(res.body.litellm_params.output_cost_per_token).toBe(0.000_01);
		expect((updated[0]?.litellm_params as Record<string, unknown>).api_key).toBe("sk-rotated-secret");
		expect(litellmRouter.getDeployment("model-1")?.litellm_params.api_key).toBe("sk-rotated-secret");
	});

	it.each([
		["model_name", { model_name: "new-name" }],
		["litellm_params", { litellm_params: { api_base: "https://new.example" } }],
		["model_info", { model_info: { description: "new" } }],
	] as const)("PATCH 可独立部分更新 %s，缺失字段保持不变", async (_field, patch) => {
		const app = makeApp({ existing: [NESTED_MODEL_ROW] });
		const res = await request(app).patch("/model/model-1/update").send(patch);

		expect(res.status).toBe(200);
		expect(Object.keys(res.body).sort()).toEqual([...PYTHON_MODEL_FIELDS].sort());
		expect(res.body.model_id).toBe("model-1");
		expect(res.body.created_at).toBe(NESTED_MODEL_ROW.created_at.toISOString());
		expect(res.body.created_by).toBe(NESTED_MODEL_ROW.created_by);
		expect(res.body.model_info.id).toBe("model-1");
		expect(res.body.litellm_params.model).toBe("gpt-4");
		expect(res.body.updated_by).toBe("default_user_id");
		expect(new Date(res.body.updated_at).getTime()).toBeGreaterThan(NESTED_MODEL_ROW.updated_at.getTime());
		if (_field === "model_name") {
			expect(res.body.model_name).toBe("new-name");
			expect(res.body.litellm_params.api_base).toBe("https://old.example");
		} else if (_field === "litellm_params") {
			expect(res.body.model_name).toBe("old-name");
			expect(res.body.litellm_params.api_base).toBe("https://new.example");
		} else {
			expect(res.body.model_info.description).toBe("new");
			expect(res.body.model_name).toBe("old-name");
		}
	});

	it("PATCH 嵌套 null 删除普通字段，但不得删除 litellm_params.model 或 model_info.id", async () => {
		const app = makeApp({ existing: [NESTED_MODEL_ROW] });
		const res = await request(app)
			.patch("/model/model-1/update")
			.send({ litellm_params: { extra_body: { remove: null } }, model_info: { nested: { remove: null } } });

		expect(res.status).toBe(200);
		expect(res.body.litellm_params.extra_body).toEqual({ keep: 1 });
		expect(res.body.model_info.nested).toEqual({ keep: 1 });

		for (const invalidPatch of [{ litellm_params: { model: null } }, { model_info: { id: null } }]) {
			const invalid = await request(app).patch("/model/model-1/update").send(invalidPatch);
			expect(invalid.status).toBe(400);
		}
	});

	it("PATCH 迁移到内置 CLIProxy 时自动移除旧 Credentials 和 api_base", async () => {
		const existing = {
			...NESTED_MODEL_ROW,
			litellm_params: {
				...NESTED_MODEL_ROW.litellm_params,
				litellm_credential_name: "cli-proxy-api",
				api_key: "legacy-secret",
			},
		};
		const updated: Record<string, unknown>[] = [];
		const app = makeApp({ existing: [existing], updated });

		const res = await request(app)
			.patch("/model/model-1/update")
			.send({ litellm_params: { model: "gpt-5.4", custom_llm_provider: "codex-subscription" } });

		expect(res.status).toBe(200);
		const params = updated[0]?.litellm_params as Record<string, unknown>;
		expect(params).toMatchObject({ model: "gpt-5.4", custom_llm_provider: "codex-subscription" });
		expect(params).not.toHaveProperty("litellm_credential_name");
		expect(params).not.toHaveProperty("api_base");
		expect(params).not.toHaveProperty("api_key");
	});

	it("PATCH 拒绝 URL 与 body model_info.id 冲突，且不存在时返回无 DB 细节的 404", async () => {
		const app = makeApp({ existing: [NESTED_MODEL_ROW] });
		const conflict = await request(app)
			.patch("/model/model-1/update")
			.send({ model_info: { id: "other-id" } });
		expect(conflict.status).toBe(400);
		expect((await request(app).patch("/model/model-1/update").send({})).status).toBe(400);

		const missing = await request(makeApp({ existing: [] }))
			.patch("/model/ghost/update")
			.send({ model_name: "x" });
		expect(missing.status).toBe(404);
		expect(missing.body.error.message).toBe("Model not found");
		expect(JSON.stringify(missing.body)).not.toContain("LiteLLM_ProxyModelTable");
	});

	it("更新 returning 空行时显式返回未找到错误", async () => {
		const patch = await request(makeApp({ existing: [NESTED_MODEL_ROW], updateReturning: [] }))
			.patch("/model/model-1/update")
			.send({ model_name: "new-name" });
		expect(patch.status).toBe(404);
		expect(patch.body.error.message).toBe("Model not found");

		const legacy = await request(makeApp({ existing: [NESTED_MODEL_ROW], updateReturning: [] }))
			.post("/model/update")
			.send({ model_info: { id: "model-1" }, litellm_params: { model: "gpt-4o" } });
		expect(legacy.status).toBe(400);
		expect(legacy.body.error.message).toBe("Authentication Error, model not found");
	});

	it("旧 POST 可更新 model_name/model_info，null 不覆盖，并继续返回 Python 风格错误", async () => {
		const app = makeApp({ existing: [NESTED_MODEL_ROW] });
		const res = await request(app)
			.post("/model/update")
			.send({
				model_name: "legacy-name",
				model_info: { id: "model-1", description: "legacy", nested: { remove: null } },
				litellm_params: { model: "gpt-4o", api_base: null },
			});

		expect(res.status).toBe(200);
		expect(res.body.model_name).toBe("legacy-name");
		expect(res.body.model_info).toMatchObject({ id: "model-1", description: "legacy", nested: { keep: 1, remove: 2 } });
		expect(res.body.litellm_params).toMatchObject({ model: "gpt-4o", api_base: "https://old.example" });

		const nulls = await request(app)
			.post("/model/update")
			.send({
				model_name: null,
				model_info: { id: "model-1", description: null },
				litellm_params: { model: null, api_base: null },
			});
		expect(nulls.status).toBe(200);
		expect(nulls.body.model_name).toBe("old-name");
		expect(nulls.body.model_info.description).toBe("old");
		expect(nulls.body.litellm_params).toMatchObject({ model: "gpt-4", api_base: "https://old.example" });

		const noInfo = await request(app).post("/model/update").send({ litellm_params: {} });
		expect(noInfo.status).toBe(400);
		expect(noInfo.body.error.message).toBe("Authentication Error, model_info not provided");
		const noId = await request(app).post("/model/update").send({ model_info: {}, litellm_params: {} });
		expect(noId.status).toBe(400);
		expect(noId.body.error.message).toBe("Authentication Error, model_info.id not provided");
		const notFound = await request(makeApp({ existing: [] }))
			.post("/model/update")
			.send({ model_info: { id: "ghost" }, litellm_params: { model: "x" } });
		expect(notFound.status).toBe(400);
		expect(notFound.body.error.message).toBe("Authentication Error, model not found");
	});
});

describe("ModelManagementEndpoint /model/delete 契约", () => {
	it("接受 { id } 并返回 Python 风格 message", async () => {
		const app = makeApp({});

		const res = await request(app).post("/model/delete").send({ id: "model-1" });

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ message: "Model: model-1 deleted successfully" });
	});

	it("模型不存在时返回 400", async () => {
		const app = makeApp({ deletedRowCount: 0 });

		const res = await request(app).post("/model/delete").send({ id: "ghost" });

		expect(res.status).toBe(400);
		expect(res.body.error.message).toBe("Model with id=ghost not found in db");
	});
});

describe("ModelManagementEndpoint 批次 C3 — 写操作热更新 Router", () => {
	function makeLitellmRouter(): LiteLLMRouter {
		return new LiteLLMRouter({ model_list: [], routing_strategy: RoutingStrategyName.SimpleShuffle, num_retries: 0 });
	}

	it("/model/new 落库后新模型立即可路由（Router.hasModel）", async () => {
		const litellmRouter = makeLitellmRouter();
		const app = makeApp({ litellmRouter: litellmRouter });

		expect(litellmRouter.hasModel("fresh-model")).toBe(false);
		const res = await request(app)
			.post("/model/new")
			.send({ model_name: "fresh-model", litellm_params: { model: "openai/gpt-4o" }, model_info: { id: "fresh-1" } });

		expect(res.status).toBe(200);
		expect(litellmRouter.hasModel("fresh-model")).toBe(true);
		const deployment = litellmRouter.getDeployment("fresh-1");
		expect(deployment?.litellm_params["model"]).toBe("openai/gpt-4o");
		// 对齐 Python get_model_info_with_id(db_model=True)：DB 来源模型运行时标记 db_model
		expect((deployment?.model_info as Record<string, unknown> | undefined)?.["db_model"]).toBe(true);
	});

	it("/model/update 后 Router 中同 model_id deployment 参数被替换", async () => {
		const litellmRouter = makeLitellmRouter();
		litellmRouter.addDeployment({
			model_name: "m",
			litellm_params: { model: "gpt-4" },
			model_info: { id: "model-1", db_model: true } as never,
		});
		const app = makeApp({ existing: [MODEL_ROW], litellmRouter: litellmRouter });

		const res = await request(app)
			.patch("/model/model-1/update")
			.send({ litellm_params: { model: "gpt-4o" } });

		expect(res.status).toBe(200);
		expect(litellmRouter.getDeployment("model-1")?.litellm_params["model"]).toBe("gpt-4o");
	});

	it("/model/delete 后模型从 Router 移除，不再可路由", async () => {
		const litellmRouter = makeLitellmRouter();
		litellmRouter.addDeployment({
			model_name: "m",
			litellm_params: { model: "gpt-4" },
			model_info: { id: "model-1", db_model: true } as never,
		});
		const app = makeApp({ litellmRouter: litellmRouter });

		expect(litellmRouter.hasModel("m")).toBe(true);
		const res = await request(app).post("/model/delete").send({ id: "model-1" });

		expect(res.status).toBe(200);
		expect(litellmRouter.hasModel("m")).toBe(false);
	});
});

// ─── 引用面：改名级联 / 审计 / 删除守卫 ───────────────────────────
// 键控 db mock：select()/insert()/update() 按 drizzle 表对象分派，真实走
// ModelRepository / ConfigRepository，端点逻辑不做任何打桩。
import { LiteLLM_Config } from "../db/schema/config";
import { LiteLLM_ObjectPermissionTable } from "../db/schema/object-permissions";
import { LiteLLM_ProxyModelTable } from "../db/schema/proxyModels";
import { LiteLLM_TeamTable } from "../db/schema/teams";
import { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";

interface ReferenceFixture {
	models: Array<Record<string, unknown>>;
	config: Array<Record<string, unknown>>;
	teams: Array<Record<string, unknown>>;
	tokens: Array<Record<string, unknown>>;
	permissions: Array<Record<string, unknown>>;
	upserts: Array<{ param_name: string; param_value: unknown }>;
	rowUpdates: Array<{ modelId: string; model_info: unknown }>;
	teamUpdates: Array<{ teamId: string; models: string[] }>;
	tokenUpdates: Array<{ token: string; models: string[] }>;
}

function makeReferenceApp(fixture: ReferenceFixture): { app: express.Express; fixture: ReferenceFixture } {
	const tableRows = (table: unknown): Array<Record<string, unknown>> => {
		if (table === LiteLLM_ProxyModelTable) return fixture.models;
		if (table === LiteLLM_Config) return fixture.config;
		if (table === LiteLLM_TeamTable) return fixture.teams;
		if (table === LiteLLM_VerificationToken) return fixture.tokens;
		if (table === LiteLLM_ObjectPermissionTable) return fixture.permissions;
		return [];
	};
	const db = {
		select: () => ({
			from: (table: unknown) =>
				Object.assign(Promise.resolve(tableRows(table)), {
					where: () => ({
						limit: (count: number) => Promise.resolve(tableRows(table).slice(0, count)),
					}),
				}),
		}),
		insert: (table: unknown) => ({
			values: (values: Record<string, unknown>) => ({
				onConflictDoUpdate: (options: { set: Record<string, unknown> }) => {
					if (table === LiteLLM_Config) {
						fixture.upserts.push({ param_name: values.param_name as string, param_value: options.set.param_value });
					}
					return Promise.resolve();
				},
			}),
		}),
		update: (table: unknown) => ({
			set: (values: Record<string, unknown>) => ({
				where: () =>
					Object.assign(Promise.resolve(), {
						returning: () => {
							if (table === LiteLLM_ProxyModelTable) {
								const row = fixture.models.find((candidate) => candidate.model_id === "model-1") ?? fixture.models[0];
								return Promise.resolve([{ ...(row ?? {}), ...values }]);
							}
							return Promise.resolve([]);
						},
						then: undefined,
					}),
			}),
		}),
		delete: () => ({ where: () => Promise.resolve({ rowCount: 1 }) }),
	};
	// persistModelReferenceChanges 的 update ... where 不取 returning：记录后 resolve。
	const rawUpdate = db.update as unknown as (table: unknown) => { set: (v: Record<string, unknown>) => { where: () => Promise<void> } };
	db.update = ((table: unknown) => ({
		set: (values: Record<string, unknown>) => ({
			where: () => {
				if (table === LiteLLM_ProxyModelTable) fixture.rowUpdates.push({ modelId: "model-1", model_info: values.model_info });
				if (table === LiteLLM_TeamTable) fixture.teamUpdates.push({ teamId: "team-1", models: values.models as string[] });
				if (table === LiteLLM_VerificationToken) fixture.tokenUpdates.push({ token: "key-b", models: values.models as string[] });
				return Object.assign(Promise.resolve(), {
					returning: () => {
						if (table === LiteLLM_ProxyModelTable) {
							const row = fixture.models.find((candidate) => candidate.model_id === "model-1") ?? fixture.models[0];
							return Promise.resolve([{ ...(row ?? {}), ...values }]);
						}
						return Promise.resolve([]);
					},
				});
			},
		}),
	})) as never;
	void rawUpdate;
	const app = express();
	app.use(express.json());
	const router = express.Router();
	createModelManagementRoutes(router, db as never, null);
	app.use(router);
	return { app: app, fixture: fixture };
}

function referenceFixture(): ReferenceFixture {
	return {
		models: [
			{
				model_id: "model-1",
				model_name: "commandcode/deepseek-v4.1-flash",
				litellm_params: { model: "deepseek/deepseek-v4.1-flash" },
				model_info: { id: "model-1", fallbacks: ["opencode-go/deepseek-v4.1-flash"] },
				created_at: new Date(),
				created_by: "tester",
				updated_at: new Date(),
				updated_by: "tester",
			},
		],
		config: [
			{
				param_name: "router_settings",
				param_value: {
					fallbacks: [{ "old-name": ["opencode-go/deepseek-v4.1-flash"] }],
					model_group_alias: { "deepseek-v4-flash": "commandcode/deepseek-v4.1-flash" },
				},
			},
		],
		teams: [{ teamId: "team-1", models: ["old-name"] }],
		tokens: [{ token: "key-b", models: ["old-name"] }],
		permissions: [{ objectPermissionId: "perm-1", models: [] }],
		upserts: [],
		rowUpdates: [],
		teamUpdates: [],
		tokenUpdates: [],
	};
}

describe("模型引用面：审计与改名级联", () => {
	it("GET /model/references/audit 报出悬空引用（哨兵不计）", async () => {
		const { app } = makeReferenceApp(
			referenceFixtureWith({
				models: [
					{
						model_id: "model-1",
						model_name: "commandcode/deepseek-v4.1-flash",
						litellm_params: { model: "deepseek/deepseek-v4.1-flash" },
						model_info: { id: "model-1", fallbacks: [] },
						created_at: new Date(),
						created_by: "tester",
						updated_at: new Date(),
						updated_by: "tester",
					},
				],
				config: [
					{
						param_name: "router_settings",
						param_value: { fallbacks: [], model_group_alias: { "deepseek-v4-flash": "commandcode/deepseek-v4.1-flash" } },
					},
				],
				teams: [],
				tokens: [
					{ token: "key-b", models: ["old-name"] },
					{ token: "key-c", models: ["all-team-models"] },
				],
			}),
		);
		const res = await request(app).get("/model/references/audit");
		expect(res.status).toBe(200);
		expect(res.body.dangling).toEqual([{ surface: "VerificationToken.models", path: "key-b", name: "old-name" }]);
		expect(res.body.aliases).toContain("deepseek-v4-flash");
	});

	it("POST /model/rename 善后模式：把所有引用面的旧名重写到现行名字", async () => {
		const { app, fixture } = makeReferenceApp(referenceFixture());
		const res = await request(app).post("/model/rename").send({ from: "old-name", to: "commandcode/deepseek-v4.1-flash" });
		expect(res.status).toBe(200);
		expect(res.body.kind).toBe("references");
		expect(res.body.rewritten).toContainEqual({ surface: "router_settings.fallbacks", rewritten: 1 });
		const upsert = fixture.upserts.find((candidate) => candidate.param_name === "router_settings");
		expect(upsert?.param_value).toMatchObject({
			fallbacks: [{ "commandcode/deepseek-v4.1-flash": ["opencode-go/deepseek-v4.1-flash"] }],
			model_group_alias: { "deepseek-v4-flash": "commandcode/deepseek-v4.1-flash" },
		});
		expect(fixture.teamUpdates).toEqual([{ teamId: "team-1", models: ["commandcode/deepseek-v4.1-flash"] }]);
		expect(fixture.tokenUpdates).toEqual([{ token: "key-b", models: ["commandcode/deepseek-v4.1-flash"] }]);
	});

	it("POST /model/rename 别名模式：别名键连同引用一起改名，目标不能撞现有名字", async () => {
		const { app, fixture } = makeReferenceApp(referenceFixture());
		const rejected = await request(app)
			.post("/model/rename")
			.send({ from: "deepseek-v4-flash", to: "commandcode/deepseek-v4.1-flash" });
		expect(rejected.status).toBe(409);
		expect(fixture.upserts).toEqual([]);

		const res = await request(app).post("/model/rename").send({ from: "deepseek-v4-flash", to: "deepseek-v5-flash" });
		expect(res.status).toBe(200);
		expect(res.body.kind).toBe("alias");
		const upsert = fixture.upserts.find((candidate) => candidate.param_name === "router_settings");
		expect(upsert?.param_value).toMatchObject({
			model_group_alias: { "deepseek-v5-flash": "commandcode/deepseek-v4.1-flash" },
			fallbacks: [{ "old-name": ["opencode-go/deepseek-v4.1-flash"] }],
		});
	});

	it("POST /model/rename 拒绝相同名字与不存在的目标", async () => {
		const { app } = makeReferenceApp(referenceFixture());
		expect((await request(app).post("/model/rename").send({ from: "x", to: "x" })).status).toBe(400);
		expect((await request(app).post("/model/rename").send({ from: "old-name", to: "not-a-model" })).status).toBe(409);
		expect((await request(app).post("/model/rename").send({})).status).toBe(400);
	});

	it("PATCH /model/:id/update 改 model_name 时自动级联重写引用", async () => {
		const group = "commandcode/deepseek-v4.1-flash";
		const { app, fixture } = makeReferenceApp(
			referenceFixtureWith({
				config: [
					{
						param_name: "router_settings",
						param_value: {
							fallbacks: [{ [group]: ["opencode-go/deepseek-v4.1-flash"] }],
							model_group_alias: { "deepseek-v4-flash": group },
						},
					},
				],
				teams: [{ teamId: "team-1", models: [group] }],
				tokens: [{ token: "key-b", models: [group] }],
			}),
		);
		const res = await request(app).patch("/model/model-1/update").send({ model_name: "commandcode/deepseek-v5-flash" });
		expect(res.status).toBe(200);
		const upsert = fixture.upserts.find((candidate) => candidate.param_name === "router_settings");
		expect(upsert?.param_value).toMatchObject({
			fallbacks: [{ "commandcode/deepseek-v5-flash": ["opencode-go/deepseek-v4.1-flash"] }],
			model_group_alias: { "deepseek-v4-flash": "commandcode/deepseek-v5-flash" },
		});
		expect(fixture.teamUpdates).toEqual([{ teamId: "team-1", models: ["commandcode/deepseek-v5-flash"] }]);
		expect(fixture.tokenUpdates).toEqual([{ token: "key-b", models: ["commandcode/deepseek-v5-flash"] }]);
	});

	it("/model/delete 守卫：组内最后一行仍被引用时拒绝，force=true 放行", async () => {
		const blocked = makeReferenceApp(referenceFixture());
		const conflict = await request(blocked.app).post("/model/delete").send({ id: "model-1" });
		expect(conflict.status).toBe(409);
		expect(conflict.body.error.message).toContain("仍被");

		const forced = await request(blocked.app).post("/model/delete").send({ id: "model-1", force: true });
		expect(forced.status).toBe(200);

		const clean = makeReferenceApp(
			referenceFixtureWith({
				config: [{ param_name: "router_settings", param_value: { fallbacks: [], model_group_alias: {} } }],
				teams: [{ teamId: "team-1", models: [] }],
				tokens: [{ token: "key-b", models: [] }],
			}),
		);
		const allowed = await request(clean.app).post("/model/delete").send({ id: "model-1" });
		expect(allowed.status).toBe(200);
		expect(allowed.body.message).toBe("Model: model-1 deleted successfully");
	});
});

function referenceFixtureWith(overrides: Partial<ReferenceFixture>): ReferenceFixture {
	return { ...referenceFixture(), ...overrides };
}
