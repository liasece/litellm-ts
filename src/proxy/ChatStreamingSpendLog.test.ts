import express from "express";
import { MiniMaxProvider } from "../providers/MiniMaxProvider";
import request from "supertest";
import { registerChatCompletionsRoutes } from "./ChatCompletionsEndpoint";
import { requestArrivalMiddleware } from "../core/api/RequestArrival";
import * as SpendTracker from "../spend/SpendTracker";
import { SpendLogStatus } from "../types/spend";

const auth = { api_key: "sk-test", user_id: "user-1" };

function buildApp(
	provider: Record<string, unknown>,
	getNextFallback = jest.fn().mockReturnValue(null),
	options: {
		arrivalDelayMs?: number;
		onArrival?: (at: number | undefined) => void;
		journal?: { observeUpstream: () => boolean; markCompletionStart: (at?: Date) => void; flush: () => Promise<void> };
	} = {},
) {
	const deployment = {
		model_name: "chat-group",
		litellm_params: { model: "anthropic/upstream-model", custom_llm_provider: "anthropic" },
		model_info: { id: "dep-1" },
	};
	const router = {
		getAvailableDeployment: jest.fn().mockReturnValue({ deployment: deployment, provider: provider }),
		resolveModelGroupWithTrace: jest.fn((model: string) => ({
			inputModel: model,
			resolvedModel: model,
			resolutionPath: [model],
		})),
		getNextFallback: getNextFallback,
		getNextFallbackWithTrace: jest.fn((model: string, fallbackDepth: number) => {
			const fallback = getNextFallback(model, fallbackDepth) as string | null;
			return fallback === null ? null : { inputModel: fallback, resolvedModel: fallback, resolutionPath: [fallback] };
		}),
		hasModel: jest.fn().mockReturnValue(true),
		getNoAvailableDeploymentInfo: jest.fn().mockReturnValue({ cooldownSeconds: 60, cooldownList: [], preCallChecks: false }),
		maxFallbacks: 3,
		trackActiveRequest: jest.fn(),
		markFailed: jest.fn(),
	};
	const app = express();
	app.use(requestArrivalMiddleware);
	app.use(express.json());
	app.use((req, _res, next) => {
		options.onArrival?.(req.litellmRequestArrivalAt);
		next();
	});
	if (options.arrivalDelayMs !== undefined) {
		// 模拟鉴权 / 费用预留这类 handler 之前的本地等待，验证 TTFT 不会从等待之后才起算。
		app.use((_req, _res, next) => {
			setTimeout(next, options.arrivalDelayMs);
		});
	}
	app.use((req, _res, next) => {
		req.auth = auth as never;
		if (options.journal) {
			req.activeRequestJournal = options.journal as never;
		}
		next();
	});
	const expressRouter = express.Router();
	registerChatCompletionsRoutes(expressRouter, router as never, {} as never);
	app.use(expressRouter);
	return { app: app, router: router };
}

function baseProvider(overrides: Record<string, unknown> = {}) {
	return {
		transformRequest: jest.fn().mockReturnValue({
			url: "https://provider.example/v1/messages",
			method: "POST",
			headers: {},
			body: {},
		}),
		supportsStreaming: jest.fn().mockReturnValue(true),
		...overrides,
	};
}

describe("Chat streaming SpendLog", () => {
	it.each([undefined, { include_usage: false }, { include_usage: true }])(
		"MiniMax records cached usage while respecting client stream_options=%j",
		async (streamOptions) => {
			const provider = new MiniMaxProvider("minimax-key");
			jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
				const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
				const upstreamOptions = body["stream_options"] as Record<string, unknown> | undefined;
				const chunks: Record<string, unknown>[] = [
					{
						id: "chatcmpl-minimax-usage",
						object: "chat.completion.chunk",
						created: 1,
						model: "MiniMax-M3.1-Flash",
						choices: [{ index: 0, delta: { content: "OK" }, finish_reason: "stop" }],
					},
				];
				if (upstreamOptions?.["include_usage"] === true) {
					chunks.push({
						id: "chatcmpl-minimax-usage",
						object: "chat.completion.chunk",
						created: 1,
						model: "MiniMax-M3.1-Flash",
						choices: [],
						usage: {
							prompt_tokens: 1200,
							completion_tokens: 30,
							total_tokens: 1230,
							prompt_tokens_details: { cached_tokens: 1024 },
						},
					});
				}
				return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
					headers: { "content-type": "text/event-stream" },
				});
			});
			const { app } = buildApp(provider as unknown as Record<string, unknown>);
			const response = await request(app)
				.post("/v1/chat/completions")
				.send({
					model: "chat-group",
					messages: [{ role: "user", content: "Return OK" }],
					stream: true,
					...(streamOptions ? { stream_options: streamOptions } : {}),
				})
				.expect(200);
			expect(response.text).toContain('"content":"OK"');
			const chunks = response.text
				.split("\n")
				.filter((line) => line.startsWith("data: {"))
				.map((line) => JSON.parse(line.slice(6)));
			if (streamOptions?.include_usage) {
				expect(chunks.filter((chunk) => chunk.usage)).toHaveLength(1);
				expect(chunks.at(-1)?.usage).toMatchObject({
					prompt_tokens: 1200,
					completion_tokens: 30,
					prompt_tokens_details: { cached_tokens: 1024 },
				});
			} else {
				expect(chunks).toHaveLength(1);
				expect(response.text).not.toContain('"usage":');
			}
			expect(response.text).not.toContain('"_usage":');
			expect(spendSpy).toHaveBeenCalledTimes(1);
			expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
				status: SpendLogStatus.Success,
				prompt_tokens: 1200,
				completion_tokens: 30,
				total_tokens: 1230,
				cache_read_input_tokens: 1024,
			});
		},
	);

	let spendSpy: jest.SpyInstance;
	let previousStorePrompts: string | undefined;

	beforeEach(() => {
		previousStorePrompts = process.env["STORE_PROMPTS_IN_SPEND_LOGS"];
		process.env["STORE_PROMPTS_IN_SPEND_LOGS"] = "true";
		spendSpy = jest.spyOn(SpendTracker, "trackSpendLog").mockResolvedValue({ status: "committed", requestId: "request-1", spend: 0 });
		jest.spyOn(global, "fetch").mockResolvedValue(new globalThis.Response("stream"));
	});

	afterEach(() => {
		if (previousStorePrompts === undefined) {
			delete process.env["STORE_PROMPTS_IN_SPEND_LOGS"];
		} else {
			process.env["STORE_PROMPTS_IN_SPEND_LOGS"] = previousStorePrompts;
		}
		jest.restoreAllMocks();
	});

	it.each(["http", "network"])("attributes exhausted streaming fallbacks to the last actual deployment (%s)", async (failure) => {
		const provider = baseProvider();
		const { app, router } = buildApp(
			provider,
			jest.fn((model: string) => (model === "chat-group" ? "fallback-group" : null)),
		);
		const first = router.getAvailableDeployment();
		const finalDeployment = {
			model_name: "fallback-group",
			litellm_params: { model: "MiniMax-M3.1-Flash", custom_llm_provider: "minimax" },
			model_info: { id: "dep-final" },
		};
		router.getAvailableDeployment.mockImplementation((model: string) =>
			model === "chat-group" ? first : { deployment: finalDeployment, provider },
		);
		const fetchMock = jest.mocked(global.fetch);
		fetchMock.mockReset().mockResolvedValueOnce(new Response('{"error":"initial unavailable"}', { status: 503 }));
		if (failure === "network") {
			fetchMock.mockRejectedValueOnce(new TypeError("final connection failed"));
		} else {
			fetchMock.mockResolvedValueOnce(new Response('{"error":"final overloaded"}', { status: 529 }));
		}
		await request(app)
			.post("/v1/chat/completions")
			.send({ model: "chat-group", messages: [{ role: "user", content: "hello" }], stream: true });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(spendSpy).toHaveBeenCalledTimes(1);
		expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
			status: SpendLogStatus.Failure,
			model: "MiniMax-M3.1-Flash",
			model_group: "chat-group",
			model_id: "dep-final",
			custom_llm_provider: "minimax",
			metadata: { fallback_models: ["chat-group", "fallback-group"] },
		});
	});

	it("聚合多 choice、tool calls、reasoning、真实 usage，并不向客户端泄漏内部 usage", async () => {
		const provider = baseProvider({
			streamResponse: async function* () {
				yield {
					id: "chatcmpl-stream",
					object: "chat.completion.chunk",
					created: 123,
					model: "upstream-model",
					choices: [
						{ index: 0, delta: { role: "assistant", content: "Hel", reasoning_content: "think-" }, finish_reason: null },
						{
							index: 1,
							delta: {
								role: "assistant",
								tool_calls: [{ index: 0, id: "call_", type: "function", function: { name: "look", arguments: '{"q":' } }],
							},
							finish_reason: null,
						},
					],
				};
				yield {
					id: "chatcmpl-stream",
					object: "chat.completion.chunk",
					created: 123,
					model: "upstream-model",
					choices: [
						{
							index: 0,
							delta: {
								content: "lo",
								reasoning_content: "done",
								thinking_blocks: [{ type: "thinking", thinking: "t", signature: "s" }],
								provider_specific_fields: { citations: [{ url: "https://example.com" }] },
							},
							finish_reason: "stop",
						},
						{
							index: 1,
							delta: { tool_calls: [{ index: 0, id: "1", function: { name: "up", arguments: '"x"}' } }] },
							finish_reason: "tool_calls",
						},
					],
					_usage: {
						prompt_tokens: 11,
						completion_tokens: 7,
						total_tokens: 18,
						cache_creation_input_tokens: 3,
						cache_read_input_tokens: 5,
					},
				};
			},
		});
		const { app, router } = buildApp(provider);
		router.resolveModelGroupWithTrace.mockReturnValue({
			inputModel: "chat-group",
			resolvedModel: "resolved-chat-group",
			resolutionPath: ["chat-group", "nested-alias", "resolved-chat-group"],
		});

		const response = await request(app)
			.post("/v1/chat/completions")
			.send({ model: "chat-group", messages: [{ role: "user", content: "hello" }], stream: true })
			.expect(200);

		expect(response.text).not.toContain("_usage");
		expect(response.text).not.toContain("_modelResolutionChain");
		expect(global.fetch).toHaveBeenCalledWith(
			"https://provider.example/v1/messages",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(spendSpy).toHaveBeenCalledTimes(1);
		expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
			status: SpendLogStatus.Success,
			prompt_tokens: 11,
			completion_tokens: 7,
			total_tokens: 18,
			cache_creation_input_tokens: 3,
			cache_read_input_tokens: 5,
			metadata: {
				model_resolution_chain: [
					{
						fallback_index: 0,
						input_model: "chat-group",
						resolved_model: "resolved-chat-group",
						resolution_path: ["chat-group", "nested-alias", "resolved-chat-group"],
					},
				],
			},
			messages: [{ role: "user", content: "hello" }],
			response: {
				id: "chatcmpl-stream",
				object: "chat.completion",
				created: 123,
				model: "chat-group",
				choices: [
					{
						index: 0,
						finish_reason: "stop",
						message: {
							role: "assistant",
							content: "Hello",
							reasoning_content: "think-done",
							thinking_blocks: [{ type: "thinking", thinking: "t", signature: "s" }],
							provider_specific_fields: { citations: [{ url: "https://example.com" }] },
						},
					},
					{
						index: 1,
						finish_reason: "tool_calls",
						message: {
							role: "assistant",
							content: null,
							tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } }],
						},
					},
				],
			},
		});
	});

	it("include_usage 按 OpenAI 契约在 DONE 前发送唯一 usage chunk", async () => {
		const provider = baseProvider({
			streamResponse: async function* () {
				yield {
					id: "chatcmpl-usage",
					object: "chat.completion.chunk",
					created: 123,
					model: "upstream-model",
					choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }],
				};
				yield {
					id: "chatcmpl-usage",
					object: "chat.completion.chunk",
					created: 123,
					model: "upstream-model",
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					_usage: {
						prompt_tokens: 11,
						completion_tokens: 2,
						total_tokens: 13,
						cache_creation_input_tokens: 3,
						cache_read_input_tokens: 5,
					},
				};
			},
		});
		const { app } = buildApp(provider);

		const response = await request(app)
			.post("/v1/chat/completions")
			.send({
				model: "chat-group",
				messages: [{ role: "user", content: "hello" }],
				stream: true,
				stream_options: { include_usage: true },
			})
			.expect(200);

		const payloads = response.text
			.split("\n\n")
			.filter((event) => event.startsWith("data: ") && event !== "data: [DONE]")
			.map((event) => JSON.parse(event.slice("data: ".length)) as Record<string, unknown>);
		expect(payloads).toHaveLength(3);
		expect(payloads.slice(0, -1)).toEqual([
			expect.objectContaining({ choices: expect.any(Array), usage: null }),
			expect.objectContaining({ choices: expect.any(Array), usage: null }),
		]);
		expect(payloads.at(-1)).toEqual({
			id: "chatcmpl-usage",
			object: "chat.completion.chunk",
			created: 123,
			model: "chat-group",
			choices: [],
			usage: { prompt_tokens: 11, completion_tokens: 2, total_tokens: 13 },
		});
		expect(response.text.trimEnd().endsWith("data: [DONE]")).toBe(true);
		expect(response.text).not.toContain("_usage");
		expect(response.text).not.toContain("cache_creation_input_tokens");
	});

	it("provider JSON fallback 也记录 response 与 usage", async () => {
		jest.spyOn(global, "fetch").mockResolvedValue({
			ok: true,
			body: null,
			json: async () => ({ id: "raw" }),
		} as unknown as Response);
		const transformed = {
			id: "chatcmpl-json",
			object: "chat.completion",
			created: 456,
			model: "upstream-model",
			choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "fallback" } }],
			usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
		};
		const provider = baseProvider({
			supportsStreaming: jest.fn().mockReturnValue(false),
			transformResponse: jest.fn().mockReturnValue(transformed),
		});
		const { app } = buildApp(provider);

		await request(app)
			.post("/v1/chat/completions")
			.send({ model: "chat-group", messages: [{ role: "user", content: "hello" }], stream: true })
			.expect(200);

		expect(spendSpy).toHaveBeenCalledTimes(1);
		expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
			status: SpendLogStatus.Success,
			prompt_tokens: 4,
			completion_tokens: 2,
			response: expect.objectContaining({ id: "chatcmpl-json", model: "chat-group" }),
		});
	});

	it("provider 已完成后的 accounting failure 不追加 provider failure 账务", async () => {
		spendSpy.mockRejectedValueOnce(new Error("accounting unavailable"));
		const releaseSpy = jest.spyOn(SpendTracker, "releaseSpend").mockResolvedValue({
			status: "released",
			requestId: "request-1",
			reserved: 0,
			actual: null,
		});
		const provider = baseProvider({
			streamResponse: async function* () {
				yield {
					id: "chatcmpl-accounting",
					object: "chat.completion.chunk",
					created: 123,
					model: "upstream-model",
					choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
					_usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				};
			},
		});
		const { app } = buildApp(provider);

		await request(app)
			.post("/v1/chat/completions")
			.send({ model: "chat-group", messages: [{ role: "user", content: "hello" }], stream: true })
			.expect(200);

		expect(spendSpy).toHaveBeenCalledTimes(1);
		expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({ status: SpendLogStatus.Success });
		expect(releaseSpy).not.toHaveBeenCalled();
	});

	it("无可用 deployment 的终止失败日志保存初始 alias 轨迹和 fallback 统计", async () => {
		const provider = baseProvider();
		const { app, router } = buildApp(provider);
		router.getAvailableDeployment.mockReturnValue(null);
		router.resolveModelGroupWithTrace.mockReturnValue({
			inputModel: "request-alias",
			resolvedModel: "resolved-chat-group",
			resolutionPath: ["request-alias", "nested-alias", "resolved-chat-group"],
		});

		await request(app)
			.post("/v1/chat/completions")
			.send({ model: "request-alias", messages: [{ role: "user", content: "hello" }], stream: true })
			.expect(429);

		expect(spendSpy).toHaveBeenCalledTimes(1);
		expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
			status: SpendLogStatus.Failure,
			metadata: {
				attempted_retries: 0,
				max_retries: 3,
				fallback_models: ["request-alias"],
				model_resolution_chain: [
					{
						fallback_index: 0,
						input_model: "request-alias",
						resolved_model: "resolved-chat-group",
						resolution_path: ["request-alias", "nested-alias", "resolved-chat-group"],
					},
				],
			},
		});
	});

	it("partial failure 保存已聚合 response/usage，且已输出内容后不 fallback", async () => {
		const getNextFallback = jest.fn().mockReturnValue("fallback-model");
		const provider = baseProvider({
			streamResponse: async function* () {
				yield {
					id: "chatcmpl-partial",
					object: "chat.completion.chunk",
					created: 789,
					model: "upstream-model",
					choices: [{ index: 0, delta: { role: "assistant", content: "partial" }, finish_reason: null }],
					_usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
				};
				throw new Error("stream broke");
			},
		});
		const { app } = buildApp(provider, getNextFallback);

		const response = await request(app)
			.post("/v1/chat/completions")
			.send({ model: "chat-group", messages: [{ role: "user", content: "hello" }], stream: true })
			.expect(200);

		expect(response.text).toContain("stream_error");
		expect(getNextFallback).not.toHaveBeenCalled();
		expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
			status: SpendLogStatus.Failure,
			prompt_tokens: 2,
			completion_tokens: 1,
			response: expect.objectContaining({
				id: "chatcmpl-partial",
				choices: [expect.objectContaining({ message: expect.objectContaining({ content: "partial" }) })],
			}),
			error_information: expect.objectContaining({ error_message: expect.stringContaining("stream broke") }),
		});
	});

	it("preserves cost supplied by the final streaming usage", async () => {
		const provider = baseProvider({
			streamResponse: async function* () {
				yield { id: "cost-stream", choices: [], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3, cost: 0.12 } };
			},
		});
		const { app } = buildApp(provider);
		const response = await request(app)
			.post("/v1/chat/completions")
			.send({
				model: "chat-group",
				messages: [{ role: "user", content: "hi" }],
				stream: true,
				stream_options: { include_usage: true },
			});
		expect(response.status).toBe(200);
		expect(response.text).toContain('"cost":0.12');
	});
	it("tries sibling fallback before first output and records only the successful deployment", async () => {
		let attempts = 0;
		const provider = baseProvider({
			streamResponse: async function* () {
				attempts++;
				if (attempts < 3) throw new Error("before output");
				yield {
					id: "recovered",
					choices: [{ index: 0, delta: { content: "recovered" }, finish_reason: "stop" }],
					usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
				};
			},
		});
		const next = jest.fn((model: string, index: number) => (model === "chat-group" ? (["fb1", "fb2"][index] ?? null) : null));
		const { app, router } = buildApp(provider, next);
		router.getAvailableDeployment.mockImplementation((model: string) => ({
			provider: provider,
			deployment: {
				model_name: model,
				litellm_params: { model: "anthropic/upstream-model", custom_llm_provider: "anthropic" },
				model_info: { id: model },
			},
		}));
		const response = await request(app)
			.post("/v1/chat/completions")
			.send({ model: "chat-group", messages: [{ role: "user", content: "hi" }], stream: true });
		expect(response.status).toBe(200);
		expect(response.text).toContain("recovered");
		expect(response.text).not.toContain("stream_error");
		expect(attempts).toBe(3);
		expect(spendSpy).toHaveBeenCalledTimes(1);
		expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({ model_id: "fb2", status: SpendLogStatus.Success });
	});
});

describe("Dashboard TTFT 口径", () => {
	let spendSpy: jest.SpyInstance;
	let previousStorePrompts: string | undefined;

	beforeEach(() => {
		previousStorePrompts = process.env["STORE_PROMPTS_IN_SPEND_LOGS"];
		process.env["STORE_PROMPTS_IN_SPEND_LOGS"] = "true";
		spendSpy = jest.spyOn(SpendTracker, "trackSpendLog").mockResolvedValue({ status: "committed", requestId: "request-1", spend: 0 });
		jest.spyOn(global, "fetch").mockResolvedValue(new globalThis.Response("stream"));
	});

	afterEach(() => {
		if (previousStorePrompts === undefined) {
			delete process.env["STORE_PROMPTS_IN_SPEND_LOGS"];
		} else {
			process.env["STORE_PROMPTS_IN_SPEND_LOGS"] = previousStorePrompts;
		}
		jest.restoreAllMocks();
	});

	it("从请求到达起算，handler 之前的本地等待计入 TTFT", async () => {
		let arrivedAt: number | undefined;
		const provider = baseProvider({
			streamResponse: async function* () {
				yield { id: "arrival", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] };
			},
		});
		const { app } = buildApp(provider, jest.fn().mockReturnValue(null), {
			arrivalDelayMs: 30,
			onArrival: (at) => {
				arrivedAt = at;
			},
		});
		await request(app)
			.post("/v1/chat/completions")
			.send({ model: "chat-group", messages: [{ role: "user", content: "hi" }], stream: true })
			.expect(200);
		const log = spendSpy.mock.calls[0]?.[1] as unknown as { startTime: string; completionStartTime: string };
		expect(arrivedAt).toBeDefined();
		// 起点必须等于到达时刻；修复前这里是进入 handler 的时间，会把 30ms 的本地等待排除掉。
		expect(log.startTime).toBe(new Date(arrivedAt!).toISOString());
		expect(new Date(log.completionStartTime).getTime() - new Date(log.startTime).getTime()).toBeGreaterThanOrEqual(20);
	});

	it("流式 TTFT 取首个写回下游的内容帧，被过滤的上游 chunk 不算首字", async () => {
		let afterIgnoredChunk = 0;
		const provider = baseProvider({
			streamResponse: async function* () {
				// 只有 usage、没有 choices 的 chunk 在 include_usage=false 时不会写给客户端，
				// 上游先吐出它不代表客户端拿到了首字。
				yield {
					id: "ttft",
					object: "chat.completion.chunk",
					choices: [],
					usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
				};
				afterIgnoredChunk = Date.now();
				await new Promise((resolve) => setTimeout(resolve, 30));
				yield { id: "ttft", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "hi" }, finish_reason: "stop" }] };
			},
		});
		const { app } = buildApp(provider);
		const response = await request(app)
			.post("/v1/chat/completions")
			.send({ model: "chat-group", messages: [{ role: "user", content: "hi" }], stream: true })
			.expect(200);
		expect(response.text).toContain('"content":"hi"');
		const log = spendSpy.mock.calls[0]?.[1] as unknown as { completionStartTime: string; endTime: string };
		// 修复前首字记在上游第一个 chunk 到达时（早于这里的 30ms），客户端此刻还没收到任何内容。
		expect(new Date(log.completionStartTime).getTime()).toBeGreaterThanOrEqual(afterIgnoredChunk + 20);
		expect(new Date(log.completionStartTime).getTime()).toBeLessThanOrEqual(new Date(log.endTime).getTime());
	});

	it("首个内容帧写出时立即把 TTFT 补写在途行，且与最终日志同一时刻", async () => {
		let afterIgnoredChunk = 0;
		const markCompletionStart = jest.fn();
		const provider = baseProvider({
			streamResponse: async function* () {
				// 只有 usage 的 chunk 不写回下游，上游刚吐出它时客户端还没有首字。
				yield { id: "in-flight", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 } };
				afterIgnoredChunk = Date.now();
				await new Promise((resolve) => setTimeout(resolve, 30));
				yield { id: "in-flight", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "hi" }, finish_reason: "stop" }] };
			},
		});
		const { app } = buildApp(provider, jest.fn().mockReturnValue(null), {
			journal: { observeUpstream: () => false, markCompletionStart: markCompletionStart, flush: async () => undefined },
		});
		await request(app)
			.post("/v1/chat/completions")
			.send({ model: "chat-group", messages: [{ role: "user", content: "hi" }], stream: true })
			.expect(200);
		const log = spendSpy.mock.calls[0]?.[1] as unknown as { completionStartTime: string };
		// 修复前补写挂在上游首个 chunk 上：这里的 usage-only chunk 会让在途行提前出现 TTFT。
		expect(markCompletionStart).toHaveBeenCalledTimes(1);
		const persistedAt = markCompletionStart.mock.calls[0]?.[0] as Date;
		expect(persistedAt.getTime()).toBeGreaterThanOrEqual(afterIgnoredChunk + 20);
		// 在途行与最终日志必须复用同一时刻，否则「进行中」与「落账后」的 TTFT 会跳变。
		expect(persistedAt.toISOString()).toBe(log.completionStartTime);
	});
});
