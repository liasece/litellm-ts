/**
 * Python LiteLLM core proxy alias route parity tests.
 */
import express from "express";
import request from "supertest";
import { registerController } from "../core/api/registerController";
import { registerChatCompletionsRoutes } from "./ChatCompletionsEndpoint";
import { registerCompletionsRoutes } from "./CompletionsEndpoint";
import { registerEmbeddingsRoutes } from "./EmbeddingsEndpoint";
import { ImageController } from "./ImageEndpoint";
import { AudioController } from "./AudioEndpoint";
import { registerResponsesApiRoutes } from "./ResponsesApiEndpoints";
import type { Router as LiteLLMRouter } from "../router/Router";
import * as SpendTracker from "../spend/SpendTracker";
import { CallType } from "../types/spend";

function buildApp(register: (router: express.Router) => void): express.Express {
	const app = express();
	app.use(express.json());
	const router = express.Router();
	register(router);
	app.use(router);
	return app;
}

describe("core proxy alias routes", () => {
	test.each([
		["/engines/azure-chat/chat/completions", "azure-chat"],
		["/openai/deployments/azure-chat/chat/completions", "azure-chat"],
		["/engines/provider/custom-chat/chat/completions", "provider/custom-chat"],
		["/openai/deployments/provider/custom-chat/chat/completions", "provider/custom-chat"],
	])("POST %s delegates to chat completions handler with path model", async (path, expectedModel) => {
		const completion = jest.fn().mockResolvedValue({ id: "chatcmpl-test", object: "chat.completion" });
		const router = { completion: completion } as unknown as LiteLLMRouter;
		const app = buildApp((expressRouter) => registerChatCompletionsRoutes(expressRouter, router, {} as never));

		await request(app)
			.post(path)
			.send({ model: "body-model", messages: [{ role: "user", content: "hello" }], temperature: 0.2 })
			.expect(200)
			.expect({ id: "chatcmpl-test", object: "chat.completion" });

		expect(completion).toHaveBeenCalledWith(expectedModel, [{ role: "user", content: "hello" }], { temperature: 0.2 });
	});

	test("POST /v1/chat/completions delegates to chat completions handler with body model", async () => {
		const completion = jest.fn().mockResolvedValue({ id: "chatcmpl-test", object: "chat.completion" });
		const router = { completion: completion } as unknown as LiteLLMRouter;
		const app = buildApp((expressRouter) => registerChatCompletionsRoutes(expressRouter, router, {} as never));

		await request(app)
			.post("/v1/chat/completions")
			.send({ model: "body-chat", messages: [{ role: "user", content: "hello" }], temperature: 0.2 })
			.expect(200)
			.expect({ id: "chatcmpl-test", object: "chat.completion" });

		expect(completion).toHaveBeenCalledWith("body-chat", [{ role: "user", content: "hello" }], { temperature: 0.2 });
	});

	describe("POST /v1/chat/completions 流式错误分流", () => {
		function buildStreamRouter(overrides: Partial<LiteLLMRouter>): LiteLLMRouter {
			return {
				getAvailableDeployment: jest.fn().mockReturnValue(null),
				getNextFallback: jest.fn().mockReturnValue(null),
				hasModel: jest.fn().mockReturnValue(false),
				getNoAvailableDeploymentInfo: jest.fn().mockReturnValue({ cooldownSeconds: 60, cooldownList: [], preCallChecks: false }),
				...overrides,
			} as unknown as LiteLLMRouter;
		}

		test("未知模型流式请求返回 400（PY route_llm_request ProxyModelNotFoundError）", async () => {
			const router = buildStreamRouter({});
			const app = buildApp((expressRouter) => registerChatCompletionsRoutes(expressRouter, router, {} as never));

			await request(app)
				.post("/v1/chat/completions")
				.send({ model: "ghost-model", messages: [{ role: "user", content: "hello" }], stream: true })
				.expect(400)
				.expect({
					error: {
						message:
							"{'error': '/chat/completions: Invalid model name passed in model=ghost-model. Call `/v1/models` to view available models for your key.'}",
						type: "None",
						param: "None",
						code: "400",
					},
				});
		});

		test("已知模型全部署不可用时流式请求返回 429 no-deployments", async () => {
			const router = buildStreamRouter({
				hasModel: jest.fn().mockReturnValue(true),
				getNoAvailableDeploymentInfo: jest
					.fn()
					.mockReturnValue({ cooldownSeconds: 60, cooldownList: ["dep-1"], preCallChecks: false }),
			} as Partial<LiteLLMRouter>);
			const app = buildApp((expressRouter) => registerChatCompletionsRoutes(expressRouter, router, {} as never));

			const response = await request(app)
				.post("/v1/chat/completions")
				.send({ model: "known-model", messages: [{ role: "user", content: "hello" }], stream: true })
				.expect(429);

			expect(response.body.error.type).toBe("None");
			expect(response.body.error.param).toBe("None");
			expect(response.body.error.code).toBe("429");
			expect(response.body.error.message).toContain("No deployments available for selected model");
		});
	});

	test.each([
		["/engines/azure-text/completions", "azure-text"],
		["/openai/deployments/azure-text/completions", "azure-text"],
		["/engines/provider/custom-text/completions", "provider/custom-text"],
		["/openai/deployments/provider/custom-text/completions", "provider/custom-text"],
	])("POST %s delegates to completions handler with path model", async (path, expectedModel) => {
		const completion = jest.fn().mockResolvedValue({ id: "cmpl-test", object: "chat.completion" });
		const router = { completion: completion } as unknown as LiteLLMRouter;
		const app = buildApp((expressRouter) => registerCompletionsRoutes(expressRouter, router));

		await request(app)
			.post(path)
			.send({ model: "body-model", prompt: "hello", temperature: 0.2 })
			.expect(200)
			.expect({ id: "cmpl-test", object: "chat.completion" });

		expect(completion).toHaveBeenCalledWith(expectedModel, [{ role: "user", content: "hello" }], { prompt: "hello", temperature: 0.2 });
	});

	test.each([
		["/engines/azure-embed/embeddings", "azure-embed"],
		["/openai/deployments/azure-embed/embeddings", "azure-embed"],
		["/engines/provider/custom-embed/embeddings", "provider/custom-embed"],
		["/openai/deployments/provider/custom-embed/embeddings", "provider/custom-embed"],
	])("POST %s delegates to embeddings handler with path model", async (path, expectedModel) => {
		const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ object: "list", data: [], model: "provider-embed" }),
		} as Response);
		const transformEmbeddingRequest = jest.fn().mockReturnValue({
			url: "https://provider.example/v1/embeddings",
			method: "POST",
			headers: { authorization: "Bearer test" },
			body: { model: "provider-embed", input: "hello", encoding_format: "float" },
			model: "provider-embed",
		});
		const getAvailableDeployment = jest.fn().mockReturnValue({
			deployment: { litellm_params: { model: "provider-embed" } },
			provider: { transformEmbeddingRequest: transformEmbeddingRequest },
		});
		const router = { getAvailableDeployment: getAvailableDeployment } as unknown as LiteLLMRouter;
		const app = buildApp((expressRouter) => registerEmbeddingsRoutes(expressRouter, router));

		await request(app)
			.post(path)
			.send({ model: "body-model", input: "hello", encoding_format: "float" })
			.expect(200)
			.expect({ object: "list", data: [], model: "provider-embed" });

		expect(getAvailableDeployment).toHaveBeenCalledWith(expectedModel);
		expect(transformEmbeddingRequest).toHaveBeenCalledWith("provider-embed", "hello", {
			encoding_format: "float",
			model: "provider-embed",
		});
		expect(fetchMock).toHaveBeenCalledWith("https://provider.example/v1/embeddings", {
			method: "POST",
			headers: { authorization: "Bearer test" },
			body: JSON.stringify({ model: "provider-embed", input: "hello", encoding_format: "float" }),
			signal: expect.any(AbortSignal),
		});
		fetchMock.mockRestore();
	});

	test.each([
		["/images/generations", { model: "dall-e-3", prompt: "cat" }, "dall-e-3", "cat"],
		["/audio/speech", { model: "tts-1", input: "hello", voice: "alloy" }, "tts-1", "hello"],
		["/audio/transcriptions", { model: "whisper-1", file: "placeholder", prompt: "meeting" }, "whisper-1", "meeting"],
	])("POST %s delegates non-v1 alias to Router", async (path, body, expectedModel, expectedContent) => {
		const completion = jest.fn().mockResolvedValue({ id: "alias-test" });
		const router = { completion: completion } as unknown as LiteLLMRouter;
		const app = buildApp((expressRouter) => {
			registerController(expressRouter, new ImageController(router));
			registerController(expressRouter, new AudioController(router));
		});

		await request(app).post(path).send(body).expect(200).expect({ id: "alias-test" });
		const expectedOptionalParams = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "model"));
		expect(completion).toHaveBeenCalledWith(
			expectedModel,
			[{ role: "user", content: expectedContent }],
			expect.objectContaining(expectedOptionalParams),
		);
	});

	test.each([
		["post", "/responses", { model: "gpt-4.1", input: "hello" }, 200],
		["get", "/responses/resp_123", undefined, 404],
		["delete", "/responses/resp_123", undefined, 404],
	] as const)("%s %s is registered as a non-v1 alias", async (method, path, body, expectedStatus) => {
		const completion = jest.fn().mockResolvedValue({ id: "resp-test" });
		const router = { completion: completion } as unknown as LiteLLMRouter;
		const app = buildApp((expressRouter) => registerResponsesApiRoutes(expressRouter, router));
		const req = request(app)[method](path);
		if (body !== undefined) {
			req.send(body);
		}
		await req.expect(expectedStatus);
	});

	describe("SpendLog integration", () => {
		const auth = { api_key: "sk-test", user_id: "user-1" };

		function buildAuthenticatedApp(register: (router: express.Router) => void): express.Express {
			const app = express();
			app.use(express.json());
			app.use((req, _res, next) => {
				req.auth = auth as never;
				next();
			});
			const router = express.Router();
			register(router);
			app.use(router);
			return app;
		}

		let spendSpy: jest.SpyInstance;

		beforeEach(() => {
			spendSpy = jest.spyOn(SpendTracker, "trackSpendLog").mockResolvedValue(undefined);
		});

		afterEach(() => {
			spendSpy.mockRestore();
			jest.restoreAllMocks();
		});

		it("Responses API records SpendLog", async () => {
			const completion = jest.fn().mockResolvedValue({ id: "resp-test", usage: { input_tokens: 3, output_tokens: 4 } });
			const router = { completion: completion } as unknown as LiteLLMRouter;
			const app = buildAuthenticatedApp((expressRouter) => registerResponsesApiRoutes(expressRouter, router, {} as never));

			await request(app).post("/responses").send({ model: "gpt-4.1", input: "hello" }).expect(200);

			expect(spendSpy).toHaveBeenCalledTimes(1);
			expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({ call_type: CallType.ACompletion, model: "gpt-4.1" });
		});

		it("Embeddings API records SpendLog", async () => {
			jest.spyOn(global, "fetch").mockResolvedValue({
				ok: true,
				json: async () => ({ object: "list", data: [], model: "provider-embed", usage: { prompt_tokens: 5, total_tokens: 5 } }),
			} as Response);
			const transformEmbeddingRequest = jest.fn().mockReturnValue({
				url: "https://provider.example/v1/embeddings",
				method: "POST",
				headers: { authorization: "Bearer test" },
				body: { model: "provider-embed", input: "hello" },
				model: "provider-embed",
			});
			const getAvailableDeployment = jest.fn().mockReturnValue({
				deployment: { model_name: "embed-group", litellm_params: { model: "provider-embed" }, model_info: { id: "embed-id" } },
				provider: { transformEmbeddingRequest: transformEmbeddingRequest },
			});
			const router = { getAvailableDeployment: getAvailableDeployment } as unknown as LiteLLMRouter;
			const app = buildAuthenticatedApp((expressRouter) => registerEmbeddingsRoutes(expressRouter, router, {} as never));

			await request(app).post("/embeddings").send({ model: "body-model", input: "hello" }).expect(200);

			expect(spendSpy).toHaveBeenCalledTimes(1);
			expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
				call_type: CallType.AEmbedding,
				model: "body-model",
				model_group: "embed-group",
			});
		});

		it.each([
			[
				"/images/generations",
				new ImageController(
					{
						completion: jest.fn().mockResolvedValue({ id: "img", usage: { prompt_tokens: 2, total_tokens: 2 } }),
					} as unknown as LiteLLMRouter,
					{} as never,
				),
				CallType.AImageGeneration,
				{ model: "dall-e-3", prompt: "cat" },
			],
			[
				"/audio/speech",
				new AudioController(
					{
						completion: jest.fn().mockResolvedValue({ id: "speech", usage: { prompt_tokens: 2, total_tokens: 2 } }),
					} as unknown as LiteLLMRouter,
					{} as never,
				),
				CallType.ASpeech,
				{ model: "tts-1", input: "hello", voice: "alloy" },
			],
			[
				"/audio/transcriptions",
				new AudioController(
					{
						completion: jest.fn().mockResolvedValue({ id: "asr", usage: { prompt_tokens: 2, total_tokens: 2 } }),
					} as unknown as LiteLLMRouter,
					{} as never,
				),
				CallType.ATranscription,
				{ model: "whisper-1", file: "placeholder", prompt: "meeting" },
			],
		] as const)("%s records SpendLog", async (path, controller, expectedCallType, body) => {
			const app = buildAuthenticatedApp((expressRouter) => registerController(expressRouter, controller));

			await request(app).post(path).send(body).expect(200);

			expect(spendSpy).toHaveBeenCalledTimes(1);
			expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({ call_type: expectedCallType, model: body.model });
		});
	});
});
