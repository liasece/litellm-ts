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
	} = {},
): express.Express {
	const existing = options.existing ?? [];
	const app = express();
	app.use(express.json());
	const router = express.Router();
	const db = {
		select: () => ({
			from: () => ({
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
			set: (values: Record<string, unknown>) => ({
				where: () => ({
					returning: () => Promise.resolve([{ ...MODEL_ROW, ...values }]),
				}),
			}),
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

	it("model_info 缺省时自动生成 uuid model_id", async () => {
		const app = makeApp({});

		const res = await request(app)
			.post("/model/new")
			.send({ model_name: "m", litellm_params: { model: "gpt-4" } });

		expect(res.status).toBe(200);
		expect(res.body.model_id).toMatch(/^[0-9a-f]{8}-/);
		expect(res.body.model_info).toMatchObject({ id: res.body.model_id, db_model: false });
	});
});

describe("ModelManagementEndpoint /model/update 契约", () => {
	it("合并更新 litellm_params 并返回 8 键完整模型行", async () => {
		const app = makeApp({ existing: [MODEL_ROW] });

		const res = await request(app)
			.post("/model/update")
			.send({ model_info: { id: "model-1" }, litellm_params: { model: "gpt-4o" } });

		expect(res.status).toBe(200);
		expect(Object.keys(res.body).sort()).toEqual([...PYTHON_MODEL_FIELDS].sort());
		expect(res.body.model_id).toBe("model-1");
		expect(res.body.litellm_params.model).toBe("gpt-4o");
		// 既有缺省字段保留
		expect(res.body.litellm_params.use_litellm_proxy).toBe(false);
	});

	it("缺 model_info / model_info.id / 模型不存在时返回 Python 风格 400", async () => {
		const app = makeApp({ existing: [] });

		const noInfo = await request(app).post("/model/update").send({ litellm_params: {} });
		expect(noInfo.status).toBe(400);
		expect(noInfo.body.error.message).toBe("Authentication Error, model_info not provided");

		const noId = await request(app).post("/model/update").send({ model_info: {}, litellm_params: {} });
		expect(noId.status).toBe(400);
		expect(noId.body.error.message).toBe("Authentication Error, model_info.id not provided");

		const notFound = await request(app)
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
			.post("/model/update")
			.send({ model_info: { id: "model-1" }, litellm_params: { model: "gpt-4o" } });

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
