/**
 * Embeddings E2E 集成测试
 *
 * 验证批次 2 错误格式标准化：
 * - 无可用部署模型 → HTTP 429 + Python 风格 { error: { message, type, param, code } }
 */
import express from "express";
import request from "supertest";
import { registerEmbeddingsRoutes } from "../../src/proxy/EmbeddingsEndpoint";

/** Mock LiteLLM Router：所有模型均无可用部署 */
class MockLiteLLMRouter {
	getAvailableDeployment(_model: string): null {
		return null;
	}

	getNoAvailableDeploymentInfo(_model: string) {
		return {
			cooldownSeconds: 300,
			cooldownList: ["deployment-id-1"],
			preCallChecks: true,
		};
	}
}

describe("Embeddings E2E", () => {
	let app: express.Express;

	beforeAll(() => {
		app = express();
		app.use(express.json());

		const router = express.Router();
		registerEmbeddingsRoutes(router, new MockLiteLLMRouter() as any);
		app.use(router);
	});

	it("无可用部署模型 → 429 + 标准 error 对象（对齐 Python 实测）", async () => {
		const res = await request(app).post("/v1/embeddings").send({ model: "some-model", input: "hello" });

		expect(res.status).toBe(429);
		expect(res.body).toEqual({
			error: {
				message:
					"No deployments available for selected model, Try again in 300 seconds. " +
					"Passed model=some-model. pre-call-checks=True, cooldown_list=['deployment-id-1']",
				type: "None",
				param: "None",
				code: "429",
			},
		});
	});

	it("缺 model 字段 → 400 + 标准 error 对象（无 success:false 包装）", async () => {
		const res = await request(app).post("/v1/embeddings").send({ input: "hello" });

		expect(res.status).toBe(400);
		expect(res.body.success).toBeUndefined();
		expect(res.body.error).toBeDefined();
		expect(res.body.error.code).toBe("400");
	});

	it("使用 provider embeddings capability 执行正式请求", async () => {
		const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ object: "list", data: [], usage: { prompt_tokens: 1, total_tokens: 1 } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const transformEmbeddingRequest = jest.fn().mockReturnValue({
			url: "https://provider.example/v1/embeddings",
			method: "POST",
			headers: { Authorization: "Bearer secret" },
			body: { model: "embed", input: "hello", dimensions: 8 },
			model: "embed",
		});
		const litellmRouter = {
			getAvailableDeployment: () => ({
				deployment: { model_name: "embed-group", litellm_params: { model: "embed", timeout: 2 } },
				provider: { transformEmbeddingRequest },
			}),
		} as any;
		const successApp = express();
		successApp.use(express.json());
		registerEmbeddingsRoutes(successApp, litellmRouter);

		await request(successApp).post("/v1/embeddings").send({ model: "embed-group", input: "hello", dimensions: 8 }).expect(200);

		expect(transformEmbeddingRequest).toHaveBeenCalledWith("embed", "hello", {
			model: "embed",
			timeout: 2,
			dimensions: 8,
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"https://provider.example/v1/embeddings",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		fetchMock.mockRestore();
	});

	it("provider 无 embeddings capability 时返回明确 unsupported error", async () => {
		const unsupportedApp = express();
		unsupportedApp.use(express.json());
		registerEmbeddingsRoutes(unsupportedApp, {
			getAvailableDeployment: () => ({
				deployment: { model_name: "anthropic", litellm_params: { model: "anthropic/claude" } },
				provider: { transformRequest: jest.fn() },
			}),
		} as any);

		const res = await request(unsupportedApp).post("/v1/embeddings").send({ model: "anthropic", input: "hello" });
		expect(res.status).toBe(400);
		expect(res.body.error.message).toContain("does not support embeddings");
	});
});
