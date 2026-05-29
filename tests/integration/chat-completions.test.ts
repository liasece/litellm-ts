/**
 * Chat Completions E2E 集成测试
 *
 * 启动真实 Express 实例，mock Router，验证全链路请求。
 */
import express from "express";
import request from "supertest";
import { registerChatCompletionsRoutes } from "../../src/proxy/ChatCompletionsEndpoint";

/** Mock LiteLLM Router */
class MockLiteLLMRouter {
	private _callCount = 0;

	async completion(model: string, messages: unknown[], _params?: Record<string, unknown>) {
		this._callCount++;
		return {
			id: `chatcmpl-${Date.now()}`,
			object: "chat.completion",
			created: Math.floor(Date.now() / 1000),
			model,
			choices: [
				{
					index: 0,
					finish_reason: "stop",
					message: {
						role: "assistant",
						content: `Mock response for ${model}`,
					},
				},
			],
			usage: {
				prompt_tokens: messages.length * 10,
				completion_tokens: 20,
				total_tokens: messages.length * 10 + 20,
			},
		};
	}

	get callCount() {
		return this._callCount;
	}
}

describe("Chat Completions E2E", () => {
	let app: express.Express;
	let mockRouter: MockLiteLLMRouter;

	beforeAll(() => {
		mockRouter = new MockLiteLLMRouter();
		app = express();
		app.use(express.json());

		const router = express.Router();
		registerChatCompletionsRoutes(router, mockRouter as any, null as any);
		app.use(router);
	});

	it("POST /v1/chat/completions returns ModelResponse", async () => {
		const res = await request(app)
			.post("/v1/chat/completions")
			.send({
				model: "claude-sonnet-4-6",
				messages: [{ role: "user", content: "Hello" }],
			});

		expect(res.status).toBe(200);
		expect(res.body.object).toBeDefined();
		expect(res.body.choices).toHaveLength(1);
		expect(res.body.choices[0].message.role).toBe("assistant");
		expect(mockRouter.callCount).toBe(1);
	});

	it("POST /chat/completions also works", async () => {
		const res = await request(app)
			.post("/chat/completions")
			.send({
				model: "deepseek-latest",
				messages: [{ role: "user", content: "Hi" }],
			});

		expect(res.status).toBe(200);
		expect(mockRouter.callCount).toBe(2);
	});

	it("returns 400 when model is missing", async () => {
		const res = await request(app).post("/v1/chat/completions").send({ messages: [] });
		expect(res.status).toBe(400);
	});
});
