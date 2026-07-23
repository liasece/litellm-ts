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
import { ApiError } from "../core/api/ApiError";

function withSpendReservationRouter(router: Record<string, unknown>): LiteLLMRouter {
	return {
		...router,
		getDeployments: () => [
			{
				model_name: "reservation-test-group",
				litellm_params: {
					model: "provider/reservation-test-model",
					input_cost_per_token: 0.001,
					output_cost_per_token: 0.002,
				},
			},
		],
		getFallbacks: () => ({}),
	} as unknown as LiteLLMRouter;
}

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
		const router = withSpendReservationRouter({ completion: completion });
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
		const router = withSpendReservationRouter({ completion: completion });
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
				getDeployments: jest.fn().mockReturnValue([]),
				getFallbacks: jest.fn().mockReturnValue({}),
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
		const router = withSpendReservationRouter({ completion: completion });
		const app = buildApp((expressRouter) => registerCompletionsRoutes(expressRouter, router, {} as never));

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
		const router = withSpendReservationRouter({ getAvailableDeployment: getAvailableDeployment });
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
		const router = withSpendReservationRouter({ completion: completion });
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
		["get", "/responses/resp_123", undefined, 501],
		["delete", "/responses/resp_123", undefined, 501],
	] as const)("%s %s is registered as a non-v1 alias", async (method, path, body, expectedStatus) => {
		const completion = jest.fn().mockResolvedValue({ id: "resp-test" });
		const router = withSpendReservationRouter({ completion: completion });
		const app = buildApp((expressRouter) => registerResponsesApiRoutes(expressRouter, router));
		const req = request(app)[method](path);
		if (body !== undefined) {
			req.send(body);
		}
		await req.expect(expectedStatus);
	});

	describe("SpendLog integration", () => {
		const auth = {
			api_key: "sk-test",
			user_id: "user-1",
			budget_snapshots: { key: { id: "sk-test", spend: 0, max_budget: 10 } },
		};

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
		let reserveSpy: jest.SpyInstance;

		beforeEach(() => {
			reserveSpy = jest.spyOn(SpendTracker, "reserveSpend").mockResolvedValue({
				status: "reserved",
				requestId: "request-1",
				reserved: 0.01,
				actual: null,
			});
			spendSpy = jest.spyOn(SpendTracker, "trackSpendLog").mockResolvedValue({
				status: "committed",
				requestId: "request-1",
				spend: 0.01,
			});
		});

		afterEach(() => {
			spendSpy.mockRestore();
			jest.restoreAllMocks();
		});

		it.each([
			["/v1/completions", "body-model"],
			["/completions", "body-model"],
			["/engines/path-model/completions", "path-model"],
			["/openai/deployments/path-model/completions", "path-model"],
		] as const)("%s reserves before provider and records Completions SpendLog", async (path, expectedModel) => {
			const completion = jest.fn().mockResolvedValue({
				id: "cmpl-test",
				usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
			});
			const router = withSpendReservationRouter({ completion: completion });
			const app = buildAuthenticatedApp((expressRouter) => registerCompletionsRoutes(expressRouter, router, {} as never));

			await request(app)
				.post(path)
				.set("x-request-id", `request-${expectedModel}`)
				.send({ model: "body-model", prompt: "hello" })
				.expect(200);

			expect(reserveSpy).toHaveBeenCalledTimes(1);
			expect(reserveSpy.mock.invocationCallOrder[0]).toBeLessThan(completion.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER);
			expect(spendSpy).toHaveBeenCalledTimes(1);
			expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
				call_type: CallType.ACompletion,
				model: expectedModel,
				model_group: expectedModel,
				request_id: expect.any(String),
				status: "success",
			});
		});

		it("Completions streams provider chunks and records final usage", async () => {
			async function* stream() {
				yield { id: "cmpl-stream", choices: [{ text: "hello" }] };
				yield { id: "cmpl-stream", choices: [], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } };
			}
			const completion = jest.fn().mockResolvedValue({ _stream: true, stream: stream() });
			const router = withSpendReservationRouter({ completion: completion });
			const app = buildAuthenticatedApp((expressRouter) => registerCompletionsRoutes(expressRouter, router, {} as never));

			const response = await request(app)
				.post("/v1/completions")
				.send({ model: "text-model", prompt: "hello", stream: true })
				.expect(200);

			expect(response.headers["content-type"]).toContain("text/event-stream");
			expect(response.text).toContain('data: {"id":"cmpl-stream","choices":[{"text":"hello"}]}');
			expect(response.text).toContain("data: [DONE]");
			expect(spendSpy).toHaveBeenCalledTimes(1);
			expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
				status: "success",
				prompt_tokens: 2,
				completion_tokens: 1,
				total_tokens: 3,
			});
		});

		it("Completions preserves provider error when failure accounting and release also fail", async () => {
			const providerError = ApiError.tooManyRequests("provider overloaded");
			spendSpy.mockRejectedValueOnce(ApiError.unavailable("accounting unavailable"));
			jest.spyOn(SpendTracker, "releaseSpend").mockRejectedValueOnce(ApiError.unavailable("release unavailable"));
			const completion = jest.fn().mockRejectedValue(providerError);
			const router = withSpendReservationRouter({ completion: completion });
			const app = buildAuthenticatedApp((expressRouter) => registerCompletionsRoutes(expressRouter, router, {} as never));

			const response = await request(app).post("/v1/completions").send({ model: "text-model", prompt: "hello" }).expect(429);

			expect(response.body.error.message).toBe("provider overloaded");
			expect(spendSpy).toHaveBeenCalledTimes(1);
			expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({ status: "failure" });
			expect(SpendTracker.releaseSpend).toHaveBeenCalledTimes(1);
		});

		it("Completions provider success keeps accounting error and does not write a failure log", async () => {
			spendSpy.mockRejectedValueOnce(ApiError.unavailable("accounting unavailable"));
			const completion = jest.fn().mockResolvedValue({
				id: "cmpl-test",
				usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
			});
			const router = withSpendReservationRouter({ completion: completion });
			const app = buildAuthenticatedApp((expressRouter) => registerCompletionsRoutes(expressRouter, router, {} as never));

			await request(app).post("/v1/completions").send({ model: "text-model", prompt: "hello" }).expect(503);

			expect(completion).toHaveBeenCalledTimes(1);
			expect(spendSpy).toHaveBeenCalledTimes(1);
			expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({ status: "success" });
		});

		it("Responses API records SpendLog", async () => {
			const completion = jest.fn().mockResolvedValue({ id: "resp-test", usage: { input_tokens: 3, output_tokens: 4 } });
			const router = withSpendReservationRouter({ completion: completion });
			const app = buildAuthenticatedApp((expressRouter) => registerResponsesApiRoutes(expressRouter, router, {} as never));

			await request(app)
				.post("/responses")
				.set("x-request-id", "responses-request")
				.send({ model: "gpt-4.1", input: "hello" })
				.expect(200);

			expect(reserveSpy).toHaveBeenCalledTimes(1);
			expect(reserveSpy.mock.invocationCallOrder[0]).toBeLessThan(completion.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER);
			expect(spendSpy).toHaveBeenCalledTimes(1);
			expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
				call_type: CallType.ACompletion,
				model: "gpt-4.1",
				request_id: expect.any(String),
			});
		});

		it.each([
			[
				"Chat Completions",
				"/v1/chat/completions",
				{ model: "gpt-4.1", messages: [{ role: "user", content: "hello" }] },
				(expressRouter: express.Router, router: LiteLLMRouter) => registerChatCompletionsRoutes(expressRouter, router, {} as never),
			],
			[
				"Responses",
				"/responses",
				{ model: "gpt-4.1", input: "hello" },
				(expressRouter: express.Router, router: LiteLLMRouter) => registerResponsesApiRoutes(expressRouter, router, {} as never),
			],
		] as const)("%s provider 成功后的账务 503 不会被改写为失败日志", async (_name, path, body, register) => {
			const accountingError = ApiError.unavailable("accounting unavailable");
			spendSpy.mockRejectedValueOnce(accountingError);
			const completion = jest.fn().mockResolvedValue({
				id: "provider-success",
				usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
			});
			const router = withSpendReservationRouter({ completion: completion });
			const app = buildAuthenticatedApp((expressRouter) => register(expressRouter, router));

			await request(app).post(path).send(body).expect(503);

			expect(completion).toHaveBeenCalledTimes(1);
			expect(spendSpy).toHaveBeenCalledTimes(1);
			expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({ status: "success" });
		});

		it("Responses duplicate reservation blocks provider call", async () => {
			reserveSpy.mockResolvedValueOnce({
				status: "duplicate",
				requestId: "request-1",
				reserved: 0.01,
				actual: null,
			});
			const completion = jest.fn();
			const router = withSpendReservationRouter({ completion: completion });
			const app = buildAuthenticatedApp((expressRouter) => registerResponsesApiRoutes(expressRouter, router, {} as never));

			await request(app).post("/responses").send({ model: "gpt-4.1", input: "hello" }).expect(409);

			expect(completion).not.toHaveBeenCalled();
			expect(spendSpy).not.toHaveBeenCalled();
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
			const router = withSpendReservationRouter({ getAvailableDeployment: getAvailableDeployment });
			const app = buildAuthenticatedApp((expressRouter) => registerEmbeddingsRoutes(expressRouter, router, {} as never));

			await request(app)
				.post("/embeddings")
				.set("x-request-id", "embeddings-request")
				.send({ model: "body-model", input: "hello" })
				.expect(200);

			expect(reserveSpy).toHaveBeenCalledTimes(1);
			expect(reserveSpy.mock.invocationCallOrder[0]).toBeLessThan(
				(global.fetch as jest.Mock).mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
			);
			expect(spendSpy).toHaveBeenCalledTimes(1);
			expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
				call_type: CallType.AEmbedding,
				model: "body-model",
				model_group: "embed-group",
				request_id: expect.any(String),
			});
		});

		it("Embeddings provider 成功后的账务 503 不会被改写为失败日志", async () => {
			spendSpy.mockRejectedValueOnce(ApiError.unavailable("accounting unavailable"));
			const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
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
			const router = withSpendReservationRouter({ getAvailableDeployment: getAvailableDeployment });
			const app = buildAuthenticatedApp((expressRouter) => registerEmbeddingsRoutes(expressRouter, router, {} as never));

			await request(app).post("/embeddings").send({ model: "body-model", input: "hello" }).expect(503);

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(spendSpy).toHaveBeenCalledTimes(1);
			expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({ status: "success" });
		});

		it.each([
			[
				"/images/generations",
				new ImageController(
					withSpendReservationRouter({
						completion: jest.fn().mockResolvedValue({ id: "img", usage: { prompt_tokens: 2, total_tokens: 2 } }),
					}),
					{} as never,
				),
				CallType.AImageGeneration,
				{ model: "dall-e-3", prompt: "cat" },
			],
			[
				"/audio/speech",
				new AudioController(
					withSpendReservationRouter({
						completion: jest.fn().mockResolvedValue({ id: "speech", usage: { prompt_tokens: 2, total_tokens: 2 } }),
					}),
					{} as never,
				),
				CallType.ASpeech,
				{ model: "tts-1", input: "hello", voice: "alloy" },
			],
			[
				"/audio/transcriptions",
				new AudioController(
					withSpendReservationRouter({
						completion: jest.fn().mockResolvedValue({ id: "asr", usage: { prompt_tokens: 2, total_tokens: 2 } }),
					}),
					{} as never,
				),
				CallType.ATranscription,
				{ model: "whisper-1", file: "placeholder", prompt: "meeting" },
			],
		] as const)("%s records SpendLog without a hard budget", async (path, controller, expectedCallType, body) => {
			const budgetSnapshots = auth.budget_snapshots;
			(auth as { budget_snapshots?: typeof budgetSnapshots }).budget_snapshots = undefined;
			try {
				const app = buildAuthenticatedApp((expressRouter) => registerController(expressRouter, controller));

				await request(app).post(path).send(body).expect(200);

				expect(spendSpy).toHaveBeenCalledTimes(1);
				expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({ call_type: expectedCallType, model: body.model });
			} finally {
				auth.budget_snapshots = budgetSnapshots;
			}
		});
	});
});
