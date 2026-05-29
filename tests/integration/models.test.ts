/**
 * ModelsEndpoint E2E 集成测试
 *
 * 启动真实 Express 实例，验证 /v1/models 端点。
 */
import express from "express";
import type { Router as ExpressRouter } from "express";
import request from "supertest";
import { registerController } from "../../src/core/api/registerController";
import { ModelsController } from "../../src/proxy/ModelsEndpoint";

/** Mock Router with dummy deployments */
class MockRouter {
	private _deployments = [
		{
			model_name: "claude-sonnet-4-6",
			litellm_params: { model: "anthropic/claude-sonnet-4-6", custom_llm_provider: "anthropic" },
		},
		{
			model_name: "deepseek-latest",
			litellm_params: { model: "deepseek/deepseek-v4-flash", custom_llm_provider: "deepseek" },
		},
	];

	getDeployments() {
		return [...this._deployments];
	}
}

describe("Models Endpoints E2E", () => {
	let app: express.Express;

	beforeAll(() => {
		app = express();
		app.use(express.json());
		const router = app as unknown as ExpressRouter;
		registerController(router, new ModelsController(new MockRouter() as any));
	});

	it("GET /v1/models returns model list", async () => {
		const res = await request(app).get("/v1/models");
		expect(res.status).toBe(200);
		expect(res.body.object).toBe("list");
		expect(res.body.data).toHaveLength(2);
		expect(res.body.data[0].id).toBe("claude-sonnet-4-6");
	});

	it("GET /v1/models/:id returns single model detail", async () => {
		const res = await request(app).get("/v1/models/claude-sonnet-4-6");
		expect(res.status).toBe(200);
		expect(res.body.id).toBe("claude-sonnet-4-6");
		expect(res.body.object).toBe("model");
	});
});
