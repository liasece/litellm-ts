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
					model: "cliproxy/gpt-5.4",
					custom_llm_provider: "cliproxy",
					litellm_credential_name: "legacy-cli-proxy",
					credential_name: "legacy-cli-proxy",
					api_base: "http://legacy.example",
					api_key: "legacy-secret",
				},
			});

		expect(res.status).toBe(200);
		expect(res.body.litellm_params).toMatchObject({
			model: "cliproxy/gpt-5.4",
			custom_llm_provider: "cliproxy",
		});
		for (const field of ["litellm_credential_name", "credential_name", "api_base", "api_key"]) {
			expect((inserted[0]?.litellm_params as Record<string, unknown>)).not.toHaveProperty(field);
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
			.send({ litellm_params: { model: "cliproxy/gpt-5.4", custom_llm_provider: "cliproxy" } });

		expect(res.status).toBe(200);
		const params = updated[0]?.litellm_params as Record<string, unknown>;
		expect(params).toMatchObject({ model: "cliproxy/gpt-5.4", custom_llm_provider: "cliproxy" });
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
