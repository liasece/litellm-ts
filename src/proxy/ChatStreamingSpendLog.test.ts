import express from "express";
import request from "supertest";
import { registerChatCompletionsRoutes } from "./ChatCompletionsEndpoint";
import * as SpendTracker from "../spend/SpendTracker";
import { SpendLogStatus } from "../types/spend";

const auth = { api_key: "sk-test", user_id: "user-1" };

function buildApp(provider: Record<string, unknown>, getNextFallback = jest.fn().mockReturnValue(null)) {
	const deployment = {
		model_name: "chat-group",
		litellm_params: { model: "anthropic/upstream-model", custom_llm_provider: "anthropic" },
		model_info: { id: "dep-1" },
	};
	const router = {
		getAvailableDeployment: jest.fn().mockReturnValue({ deployment: deployment, provider: provider }),
		getNextFallback: getNextFallback,
		hasModel: jest.fn().mockReturnValue(true),
		getNoAvailableDeploymentInfo: jest.fn().mockReturnValue({ cooldownSeconds: 60, cooldownList: [], preCallChecks: false }),
		trackActiveRequest: jest.fn(),
		markFailed: jest.fn(),
	};
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.auth = auth as never;
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
	let spendSpy: jest.SpyInstance;
	let previousStorePrompts: string | undefined;

	beforeEach(() => {
		previousStorePrompts = process.env["STORE_PROMPTS_IN_SPEND_LOGS"];
		process.env["STORE_PROMPTS_IN_SPEND_LOGS"] = "true";
		spendSpy = jest.spyOn(SpendTracker, "trackSpendLog").mockResolvedValue(undefined);
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
		const { app } = buildApp(provider);

		const response = await request(app)
			.post("/v1/chat/completions")
			.send({ model: "chat-group", messages: [{ role: "user", content: "hello" }], stream: true })
			.expect(200);

		expect(response.text).not.toContain("_usage");
		expect(spendSpy).toHaveBeenCalledTimes(1);
		expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
			status: SpendLogStatus.Success,
			prompt_tokens: 11,
			completion_tokens: 7,
			total_tokens: 18,
			cache_creation_input_tokens: 3,
			cache_read_input_tokens: 5,
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
});
