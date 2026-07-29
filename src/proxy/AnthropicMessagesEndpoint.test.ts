import express from "express";
import request from "supertest";
import { formatAnthropicPingEvent, registerAnthropicMessagesEndpoints } from "./AnthropicMessagesEndpoint";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import * as SpendTracker from "../spend/SpendTracker";
import { SpendLogStatus } from "../types/spend";

const runtimeConfig = { generalSettings: {} };

jest.mock("../core/config", () => ({ getConfig: () => runtimeConfig }));

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
		getDeployments: jest.fn().mockReturnValue([deployment]),
		getAvailableDeployment: jest.fn().mockReturnValue({ deployment: deployment, provider: provider }),
		getNextFallback: jest.fn().mockReturnValue(null),
		resolveModelGroupWithTrace: jest.fn((model: string) =>
			model === "native-group"
				? {
						inputModel: model,
						resolvedModel: "resolved-native-group",
						resolutionPath: [model, "nested-native-alias", "resolved-native-group"],
					}
				: { inputModel: model, resolvedModel: model, resolutionPath: [model] },
		),
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
	const db: {
		transaction: jest.Mock;
		select: jest.Mock;
		delete: jest.Mock;
		insert: jest.Mock;
	} = {
		transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>): Promise<unknown> => await callback(db)),
		select: jest.fn(() => ({
			from: jest.fn(() => ({
				where: jest.fn(() => ({
					limit: jest.fn().mockResolvedValue([]),
				})),
			})),
		})),
		delete: jest.fn(() => ({
			where: jest.fn().mockResolvedValue(undefined),
		})),
		insert: jest.fn(() => ({
			values: jest.fn(() => ({
				onConflictDoNothing: jest.fn(() => ({
					returning: jest.fn().mockResolvedValue([{ requestId: "active-request" }]),
				})),
			})),
		})),
	};
	registerAnthropicMessagesEndpoints(expressRouter, router as never, undefined, db as never);
	expressRouter.get("/v1/files", (_req, res) => res.json({ object: "list", data: [] }));
	app.use(expressRouter);
	(app as unknown as { __router: typeof router }).__router = router;
	return app;
}

describe("native Anthropic streaming SpendLog", () => {
	let spendSpy: jest.SpyInstance;
	let previousStorePrompts: string | undefined;

	beforeEach(() => {
		previousStorePrompts = process.env["STORE_PROMPTS_IN_SPEND_LOGS"];
		process.env["STORE_PROMPTS_IN_SPEND_LOGS"] = "true";
		spendSpy = jest.spyOn(SpendTracker, "trackSpendLog").mockResolvedValue({ status: "committed", requestId: "request-1", spend: 0 });
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
		expect(response.text).toContain('"model":"native-group"');
		expect(response.text).toContain(
			'"usage":{"input_tokens":4,"output_tokens":0,"cache_creation_input_tokens":2,"cache_read_input_tokens":3}',
		);
		expect(response.text).not.toContain('"model":"upstream-model"');
		expect(global.fetch).toHaveBeenCalledWith(
			"https://provider.example/v1/messages",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		const syntheticId = /"id":"(msg_[^"]+)"/.exec(response.text)?.[1];
		expect(syntheticId).toBeDefined();
		expect(spendSpy).toHaveBeenCalledTimes(1);
		expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
			status: SpendLogStatus.Success,
			prompt_tokens: 9,
			completion_tokens: 6,
			cache_creation_input_tokens: 2,
			cache_read_input_tokens: 3,
			metadata: {
				fallback_models: ["native-group"],
				model_resolution_chain: [
					{
						fallback_index: 0,
						input_model: "native-group",
						resolved_model: "resolved-native-group",
						resolution_path: ["native-group", "nested-native-alias", "resolved-native-group"],
					},
				],
			},
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

	it("keep-alive ping 携带 Anthropic 事件 discriminator", async () => {
		expect(formatAnthropicPingEvent()).toBe('event: ping\ndata: {"type":"ping"}\n\n');
	});

	it("非流式成功日志保存 alias 解析链并保留原始 fallback 首项", async () => {
		const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
			new globalThis.Response(
				JSON.stringify({
					id: "msg-non-stream",
					type: "message",
					role: "assistant",
					model: "upstream-model",
					content: [{ type: "text", text: "hello" }],
					stop_reason: "end_turn",
					usage: { input_tokens: 2, output_tokens: 1 },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		const app = buildApp();

		await request(app)
			.post("/v1/messages")
			.set("anthropic-version", "2025-01-01")
			.set("anthropic-beta", "feature-a,feature-b")
			.send({
				model: "native-group",
				messages: [{ role: "user", content: "hello" }],
				stream: false,
				api_key: "request-internal-key",
				anthropic_version: "body-version-must-not-leak",
			})
			.expect(200);

		const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
		expect(init?.headers).toEqual(
			expect.objectContaining({
				"anthropic-version": "2025-01-01",
				"anthropic-beta": "feature-a,feature-b",
			}),
		);
		const upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
		expect(upstreamBody).not.toHaveProperty("api_key");
		expect(upstreamBody).not.toHaveProperty("anthropic_version");
		expect(upstreamBody).toMatchObject({ model: "upstream-model" });
		expect(spendSpy).toHaveBeenCalledTimes(1);
		expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
			status: SpendLogStatus.Success,
			metadata: {
				fallback_models: ["native-group"],
				model_resolution_chain: [
					{
						fallback_index: 0,
						input_model: "native-group",
						resolved_model: "resolved-native-group",
						resolution_path: ["native-group", "nested-native-alias", "resolved-native-group"],
					},
				],
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

	it("message_stop 是终态，忽略其后的残留事件", async () => {
		jest.spyOn(global, "fetch").mockResolvedValue(
			new globalThis.Response(
				[
					`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "upstream", type: "message", role: "assistant", model: "upstream", content: [], usage: { input_tokens: 1, output_tokens: 0 } } })}\n\n`,
					`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } })}\n\n`,
					`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
					"event: trailing\ndata: {not-json}\n\n",
				].join(""),
				{ status: 200, headers: { "content-type": "text/event-stream" } },
			),
		);
		const app = buildApp();

		const response = await request(app)
			.post("/v1/messages")
			.send({ model: "native-group", messages: [{ role: "user", content: "hello" }], stream: true })
			.expect(200);

		expect(response.text).toContain("event: message_stop");
		expect(response.text).not.toContain("event: error");
		expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({ status: SpendLogStatus.Success });
	});

	it("可重试的上游 error 是唯一终态，转发后不追加 EOF 错误也不冷却 deployment", async () => {
		jest.spyOn(global, "fetch").mockResolvedValue(
			sseResponse([
				{
					type: "message_start",
					message: {
						id: "upstream-error",
						type: "message",
						role: "assistant",
						model: "upstream-model",
						content: [],
						usage: { input_tokens: 20_000, output_tokens: 0 },
					},
				},
				{
					type: "error",
					error: {
						type: "service_unavailable_error",
						message: "Upstream temporarily unavailable",
					},
				},
			]),
		);
		const app = buildApp();
		const router = (app as unknown as { __router: { recordDeploymentFailure: jest.Mock } }).__router;

		const response = await request(app)
			.post("/v1/messages")
			.send({ model: "native-group", messages: [{ role: "user", content: "hello" }], stream: true })
			.expect(200);

		expect(response.text.match(/event: error/g)).toHaveLength(1);
		expect(response.text).toContain('"type":"service_unavailable_error"');
		expect(response.text).not.toContain("Provider stream ended before message_stop");
		expect(response.text).not.toContain("event: message_stop");
		expect(router.recordDeploymentFailure).not.toHaveBeenCalled();
		expect(spendSpy).toHaveBeenCalledTimes(1);
		expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({
			status: SpendLogStatus.Failure,
			error_information: {
				error_type: "ForwardedAnthropicStreamError",
				error_message: "service_unavailable_error: Upstream temporarily unavailable",
			},
		});
	});

	it("malformed SSE event 进入唯一失败终结而非静默成功", async () => {
		jest.spyOn(global, "fetch").mockResolvedValue(
			new globalThis.Response("event: message_start\ndata: {not-json}\n\n", {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			}),
		);
		const app = buildApp();

		const response = await request(app)
			.post("/v1/messages")
			.send({ model: "native-group", messages: [{ role: "user", content: "hello" }], stream: true })
			.expect(200);

		expect(response.text).toContain("event: error");
		expect(spendSpy).toHaveBeenCalledTimes(1);
		expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({ status: SpendLogStatus.Failure });
	});

	it("上游在 message_stop 前 EOF 时发送协议 error 并记录失败", async () => {
		jest.spyOn(global, "fetch").mockResolvedValue(
			sseResponse([
				{
					type: "message_start",
					message: {
						id: "truncated",
						type: "message",
						role: "assistant",
						model: "upstream-model",
						content: [],
						usage: { input_tokens: 1, output_tokens: 0 },
					},
				},
				{ type: "message_delta", delta: { stop_reason: null, stop_sequence: null }, usage: { output_tokens: 1 } },
			]),
		);
		const app = buildApp();

		const response = await request(app)
			.post("/v1/messages")
			.send({ model: "native-group", messages: [{ role: "user", content: "hello" }], stream: true })
			.expect(200);

		expect(response.text).toContain("event: error");
		expect(response.text).toContain('"type":"error"');
		expect(response.text).not.toContain("event: message_stop");
		expect(spendSpy.mock.calls[0]?.[1]).toMatchObject({ status: SpendLogStatus.Failure });
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

describe("Anthropic/OpenAI Files protocol routing", () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("不带 anthropic-version 的 /v1/files 继续匹配 OpenAI Files 路由", async () => {
		const app = buildApp();
		const response = await request(app).get("/v1/files").expect(200);
		expect(response.body).toEqual({ object: "list", data: [] });
	});

	it("带 anthropic-version 的 /v1/files 使用 Anthropic 路由和 request-id", async () => {
		const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ data: [], has_more: false }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const app = buildApp();
		const response = await request(app).get("/v1/files?limit=20&after_id=file_1").set("anthropic-version", "2023-06-01").expect(200);
		expect(response.body).toEqual({ data: [], has_more: false });
		expect(response.headers["request-id"]).toMatch(/^req_/);
		expect(fetchSpy).toHaveBeenCalledWith(
			"https://provider.example/v1/files?limit=20&after_id=file_1",
			expect.objectContaining({
				headers: expect.objectContaining({ "anthropic-beta": expect.stringContaining("files-api-2025-04-14") }),
			}),
		);
	});

	it("Files 上传保留 multipart body 与 boundary，不伪装成 JSON", async () => {
		const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ id: "file_1", type: "file" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const app = buildApp();

		await request(app)
			.post("/v1/files")
			.set("anthropic-version", "2023-06-01")
			.attach("file", Buffer.from("hello"), "hello.txt")
			.expect(200);

		const init = fetchSpy.mock.calls[0]?.[1] as (RequestInit & { duplex?: string }) | undefined;
		expect(init?.headers).toEqual(expect.objectContaining({ "Content-Type": expect.stringContaining("multipart/form-data; boundary=") }));
		expect(init?.body).toBeDefined();
		expect(init?.duplex).toBe("half");
	});

	it("Message Batches 改写每个 params.model 且不注入顶层 model", async () => {
		const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ id: "msgbatch_1", type: "message_batch" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const app = buildApp();

		await request(app)
			.post("/v1/messages/batches")
			.send({
				requests: [
					{
						custom_id: "request-1",
						params: { model: "native-group", max_tokens: 32, messages: [{ role: "user", content: "hello" }] },
					},
				],
			})
			.expect(200);

		const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		expect(body).not.toHaveProperty("model");
		expect(body).toMatchObject({
			requests: [{ custom_id: "request-1", params: { model: "upstream-model", max_tokens: 32 } }],
		});
	});

	it("count_tokens 保留 query/version/beta 且不向上游泄漏内部凭据字段", async () => {
		const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ input_tokens: 7 }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const app = buildApp();

		await request(app)
			.post("/v1/messages/count_tokens?beta=true")
			.set("anthropic-version", "2025-01-01")
			.set("anthropic-beta", "client-feature")
			.send({
				model: "native-group",
				messages: [{ role: "user", content: "hello" }],
				api_key: "request-internal-key",
			})
			.expect(200);

		expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://provider.example/v1/messages/count_tokens?beta=true");
		const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
		expect(init?.headers).toEqual(
			expect.objectContaining({
				"anthropic-version": "2025-01-01",
				"anthropic-beta": expect.stringContaining("client-feature"),
			}),
		);
		expect(String((init?.headers as Record<string, string>)["anthropic-beta"])).toContain("token-counting-2024-11-01");
		expect(JSON.parse(String(init?.body))).not.toHaveProperty("api_key");
	});

	it("Message Batches results 与 delete 路由保持官方方法和响应类型", async () => {
		const fetchSpy = jest
			.spyOn(global, "fetch")
			.mockResolvedValueOnce(
				new Response('{"custom_id":"request-1","result":{"type":"succeeded"}}\n', {
					status: 200,
					headers: { "content-type": "application/x-jsonlines" },
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ id: "msgbatch_1", type: "message_batch_deleted" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			);
		const app = buildApp();

		const results = await request(app).get("/v1/messages/batches/msgbatch_1/results").expect(200);
		expect(results.headers["content-type"]).toContain("application/x-jsonlines");
		expect(results.text).toContain('"custom_id":"request-1"');
		const deleted = await request(app).delete("/v1/messages/batches/msgbatch_1").expect(200);
		expect(deleted.body).toEqual({ id: "msgbatch_1", type: "message_batch_deleted" });
		expect(fetchSpy.mock.calls).toEqual([
			[
				"https://provider.example/v1/messages/batches/msgbatch_1/results",
				expect.objectContaining({ headers: expect.any(Object) }),
			],
			[
				"https://provider.example/v1/messages/batches/msgbatch_1",
				expect.objectContaining({ method: "DELETE", headers: expect.any(Object) }),
			],
		]);
	});
});

describe("Anthropic web-search target model override", () => {
	afterEach(() => {
		runtimeConfig.generalSettings = {};
		jest.restoreAllMocks();
	});

	it("DB 值优先于 YAML，仅在强制 web_search 请求时改写路由模型", async () => {
		const app = buildApp();
		const router = (app as unknown as { __router: { getAvailableDeployment: jest.Mock } }).__router;
		jest.spyOn(global, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "msg-1",
					type: "message",
					role: "assistant",
					model: "upstream-model",
					content: [{ type: "text", text: "ok" }],
					stop_reason: "end_turn",
					usage: { input_tokens: 1, output_tokens: 1 },
				}),
				{ status: 200 },
			),
		);
		runtimeConfig.generalSettings = { websearch_override_target_model: "yaml-target" };
		const getParam = jest.spyOn(dbConfigProvider, "getParam").mockResolvedValue({ websearch_override_target_model: "websearch-alias" });
		const forcedWebSearchRequest = {
			model: "requested-model",
			max_tokens: 10,
			stream: true,
			messages: [{ role: "user", content: "hello" }],
			tools: [{ name: "web_search", input_schema: { type: "object" } }],
			tool_choice: { type: "tool", name: "web_search" },
		};

		await request(app).post("/v1/messages").send(forcedWebSearchRequest).expect(200);
		expect(router.getAvailableDeployment).toHaveBeenLastCalledWith("websearch-alias");

		getParam.mockResolvedValue({});
		await request(app).post("/v1/messages").send(forcedWebSearchRequest).expect(200);
		expect(router.getAvailableDeployment).toHaveBeenLastCalledWith("yaml-target");

		await request(app)
			.post("/v1/messages")
			.send({ ...forcedWebSearchRequest, tools: [{ name: "web_search" }, { name: "other_tool" }] })
			.expect(200);
		expect(router.getAvailableDeployment).toHaveBeenLastCalledWith("requested-model");
	});
});
