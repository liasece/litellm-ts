import express from "express";
import request from "supertest";
import { registerAnthropicMessagesEndpoints } from "./AnthropicMessagesEndpoint";
import * as SpendTracker from "../spend/SpendTracker";
import { SpendLogStatus } from "../types/spend";

jest.mock("../core/config", () => ({ getConfig: () => ({ generalSettings: {} }) }));

function sseResponse(events: Record<string, unknown>[]): Response {
	const body = events.map((event) => `event: ${String(event["type"])}\ndata: ${JSON.stringify(event)}\n\n`).join("");
	return new globalThis.Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function buildApp() {
	const deployment = {
		model_name: "native-group",
		litellm_params: { model: "anthropic/upstream-model", api_key: "provider-key", custom_llm_provider: "anthropic" },
		model_info: { id: "dep-native" },
	};
	const provider = {
		transformRequest: jest.fn().mockReturnValue({
			url: "https://provider.example/v1/messages",
			method: "POST",
			headers: { "x-api-key": "provider-key" },
			body: {},
		}),
	};
	const router = {
		getAvailableDeployment: jest.fn().mockReturnValue({ deployment: deployment, provider: provider }),
		getNextFallback: jest.fn().mockReturnValue(null),
		recordDeploymentSuccess: jest.fn(),
		recordDeploymentFailure: jest.fn(),
		hasModel: jest.fn().mockReturnValue(true),
		getNoAvailableDeploymentInfo: jest.fn().mockReturnValue({ cooldownSeconds: 60, cooldownList: [], preCallChecks: false }),
		maxFallbacks: 3,
	};
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.auth = { api_key: "sk-test", user_id: "user-1" } as never;
		next();
	});
	const expressRouter = express.Router();
	registerAnthropicMessagesEndpoints(expressRouter, router as never, undefined, {} as never);
	app.use(expressRouter);
	return app;
}

describe("native Anthropic streaming SpendLog", () => {
	let spendSpy: jest.SpyInstance;
	let previousStorePrompts: string | undefined;

	beforeEach(() => {
		previousStorePrompts = process.env["STORE_PROMPTS_IN_SPEND_LOGS"];
		process.env["STORE_PROMPTS_IN_SPEND_LOGS"] = "true";
		spendSpy = jest.spyOn(SpendTracker, "trackSpendLog").mockResolvedValue(undefined);
	});

	afterEach(() => {
		if (previousStorePrompts === undefined) {
			delete process.env["STORE_PROMPTS_IN_SPEND_LOGS"];
		} else {
			process.env["STORE_PROMPTS_IN_SPEND_LOGS"] = previousStorePrompts;
		}
		jest.restoreAllMocks();
	});

	it("聚合标准事件、cache usage、thinking/signature 与 tool partial JSON", async () => {
		jest.spyOn(global, "fetch").mockResolvedValue(
			sseResponse([
				{
					type: "message_start",
					message: {
						id: "upstream-id",
						type: "message",
						role: "assistant",
						model: "upstream-model",
						content: [],
						usage: { input_tokens: 4, output_tokens: 0, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 },
					},
				},
				{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
				{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
				{ type: "content_block_start", index: 1, content_block: { type: "thinking", thinking: "", signature: "" } },
				{ type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "think" } },
				{ type: "content_block_delta", index: 1, delta: { type: "signature_delta", signature: "sig" } },
				{ type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "tool-1", name: "lookup", input: {} } },
				{ type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"q":' } },
				{ type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '"x"}' } },
				{ type: "content_block_stop", index: 2 },
				{ type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 6 } },
				{ type: "message_stop" },
			]),
		);
		const app = buildApp();

		const response = await request(app)
			.post("/v1/messages")
			.send({ model: "native-group", messages: [{ role: "user", content: "hello" }], stream: true })
			.expect(200);

		expect(response.text).toContain("event: message_stop");
		const syntheticId = /"id":"(msg_[^"]+)"/.exec(response.text)?.[1];
		expect(syntheticId).toBeDefined();
		expect(spendSpy).toHaveBeenCalledTimes(1);
		expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
			status: SpendLogStatus.Success,
			prompt_tokens: 9,
			completion_tokens: 6,
			cache_creation_input_tokens: 2,
			cache_read_input_tokens: 3,
			response: {
				id: syntheticId,
				type: "message",
				role: "assistant",
				model: "native-group",
				content: [
					{ type: "text", text: "hello" },
					{ type: "thinking", thinking: "think", signature: "sig" },
					{ type: "tool_use", id: "tool-1", name: "lookup", input: { q: "x" } },
				],
				stop_reason: "tool_use",
				stop_sequence: null,
				usage: { input_tokens: 4, output_tokens: 6, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 },
			},
		});
	});

	it("流失败时保存 partial response，非法 tool JSON 保留原始字符串", async () => {
		const encoder = new TextEncoder();
		let emitted = false;
		const stream = new ReadableStream<Uint8Array>({
			pull: function (controller) {
				if (emitted) {
					controller.error(new Error("native stream broke"));
					return;
				}
				emitted = true;
				controller.enqueue(
					encoder.encode(
						[
							`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "upstream", type: "message", role: "assistant", model: "upstream", content: [], usage: { input_tokens: 1, output_tokens: 0 } } })}\n\n`,
							`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-1", name: "lookup", input: {} } })}\n\n`,
							`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{bad" } })}\n\n`,
							`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
						].join(""),
					),
				);
			},
		});
		jest.spyOn(global, "fetch").mockResolvedValue(new globalThis.Response(stream, { status: 200 }));
		const app = buildApp();

		const response = await request(app)
			.post("/v1/messages")
			.send({ model: "native-group", messages: [{ role: "user", content: "hello" }], stream: true })
			.expect(200);

		expect(response.text).toContain("event: error");
		expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
			status: SpendLogStatus.Failure,
			response: expect.objectContaining({
				content: [{ type: "tool_use", id: "tool-1", name: "lookup", input: "{bad" }],
			}),
			error_information: expect.objectContaining({ error_message: expect.stringContaining("native stream broke") }),
		});
	});

	it("保留合法的零值 usage", async () => {
		jest.spyOn(global, "fetch").mockResolvedValue(
			sseResponse([
				{
					type: "message_start",
					message: {
						id: "zero-usage",
						type: "message",
						role: "assistant",
						model: "upstream-model",
						content: [],
						usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
					},
				},
				{ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 0 } },
				{ type: "message_stop" },
			]),
		);
		const app = buildApp();

		await request(app)
			.post("/v1/messages")
			.send({ model: "native-group", messages: [{ role: "user", content: "hello" }], stream: true })
			.expect(200);

		expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
			prompt_tokens: 0,
			completion_tokens: 0,
			response: expect.objectContaining({
				usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
			}),
		});
	});
});
