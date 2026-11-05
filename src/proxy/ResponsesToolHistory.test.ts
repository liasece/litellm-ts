import express from "express";
import request from "supertest";
import { Router } from "../router/Router";
import { RoutingStrategyName, type Deployment } from "../types/router";
import { registerResponsesApiRoutes } from "./ResponsesApiEndpoints";

function deployment(modelName: string): Deployment {
	return {
		model_name: modelName,
		litellm_params: {
			model: "openai/history-provider",
			api_base: `https://${modelName}.example/v1`,
			api_key: "test-key",
		},
		model_info: { id: modelName },
	};
}

function buildApp(modelList: Deployment[], fallbacks: Array<Record<string, string[]>> = []): express.Express {
	const app = express();
	app.use(express.json());
	const router = new Router({
		model_list: modelList,
		routing_strategy: RoutingStrategyName.SimpleShuffle,
		num_retries: 0,
		fallbacks,
	});
	const routes = express.Router();
	registerResponsesApiRoutes(routes, router);
	app.use(routes);
	return app;
}

function completedResponse(stream: boolean): Response {
	const base = { id: "history-response", model: "history-provider", created: 1 };
	if (stream) {
		const chunk = {
			...base,
			object: "chat.completion.chunk",
			choices: [{ index: 0, delta: { role: "assistant", content: "Both results received." }, finish_reason: "stop" }],
		};
		return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
			headers: { "content-type": "text/event-stream" },
		});
	}
	return new Response(
		JSON.stringify({
			...base,
			object: "chat.completion",
			choices: [{ index: 0, message: { role: "assistant", content: "Both results received." }, finish_reason: "stop" }],
		}),
		{ headers: { "content-type": "application/json" } },
	);
}

const functionCall = (id: string) => ({
	type: "function_call",
	id: `fc_${id}`,
	call_id: id,
	name: "lookup",
	arguments: JSON.stringify({ key: id }),
});

const chatCall = (id: string) => ({
	id,
	type: "function",
	function: { name: "lookup", arguments: JSON.stringify({ key: id }) },
});

const output = (id: string) => ({ type: "function_call_output", call_id: id, output: `result:${id}` });
const chatOutput = (id: string) => ({ role: "tool", tool_call_id: id, content: `result:${id}` });
const tools = [{ type: "function", name: "lookup", parameters: { type: "object", properties: { key: { type: "string" } } } }];

describe("Responses tool history on the provider boundary", () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	test.each([false, true])("keeps parallel calls in one assistant turn (stream=%s)", async (stream) => {
		const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async () => completedResponse(stream));
		const app = buildApp([deployment("primary")]);
		const response = await request(app)
			.post("/v1/responses")
			.send({
				model: "primary",
				stream,
				tools,
				parallel_tool_calls: true,
				input: [
					{ role: "user", content: "Read both values." },
					{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Checking. " }] },
					functionCall("call_A"),
					{ type: "reasoning", encrypted_content: "opaque-history" },
					{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Both queued." }] },
					functionCall("call_B"),
					output("call_B"),
					output("call_A"),
				],
			})
			.expect(200);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
		expect(body.messages).toEqual([
			{ role: "user", content: "Read both values." },
			{ role: "assistant", content: "Checking. Both queued.", tool_calls: [chatCall("call_A"), chatCall("call_B")] },
			chatOutput("call_B"),
			chatOutput("call_A"),
		]);
		expect(body.parallel_tool_calls).toBe(true);
		if (stream) {
			expect(response.text).toContain('"type":"response.completed"');
		} else {
			expect(response.body.output[0].content[0].text).toBe("Both results received.");
		}
	});

	test("keeps tool-result and user boundaries between assistant turns", async () => {
		const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async () => completedResponse(false));
		await request(buildApp([deployment("primary")]))
			.post("/v1/responses")
			.send({
				model: "primary",
				tools,
				input: [
					{ role: "user", content: "First batch." },
					functionCall("call_A"),
					functionCall("call_B"),
					output("call_A"),
					output("call_B"),
					functionCall("call_C"),
					output("call_C"),
					{ role: "assistant", content: "First batch done." },
					{ role: "user", content: "Second batch." },
					functionCall("call_D"),
					output("call_D"),
				],
			})
			.expect(200);

		const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
		expect(body.messages).toEqual([
			{ role: "user", content: "First batch." },
			{ role: "assistant", content: null, tool_calls: [chatCall("call_A"), chatCall("call_B")] },
			chatOutput("call_A"),
			chatOutput("call_B"),
			{ role: "assistant", content: null, tool_calls: [chatCall("call_C")] },
			chatOutput("call_C"),
			{ role: "assistant", content: "First batch done." },
			{ role: "user", content: "Second batch." },
			{ role: "assistant", content: null, tool_calls: [chatCall("call_D")] },
			chatOutput("call_D"),
		]);
	});

	test("preserves assistant content parts when combining a tool-call turn", async () => {
		const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async () => completedResponse(false));
		await request(buildApp([deployment("primary")]))
			.post("/v1/responses")
			.send({
				model: "primary",
				tools,
				input: [
					{ role: "user", content: "Check the permitted values." },
					{ role: "assistant", content: [{ type: "refusal", refusal: "Private value unavailable." }] },
					functionCall("call_A"),
					{ role: "assistant", content: [{ type: "output_text", text: "Checking the public value." }] },
					functionCall("call_B"),
					output("call_A"),
					output("call_B"),
				],
			})
			.expect(200);

		const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
		expect(body.messages.slice(1)).toEqual([
			{
				role: "assistant",
				content: [
					{ type: "refusal", refusal: "Private value unavailable." },
					{ type: "text", text: "Checking the public value." },
				],
				tool_calls: [chatCall("call_A"), chatCall("call_B")],
			},
			chatOutput("call_A"),
			chatOutput("call_B"),
		]);
	});

	test("passes the same complete tool-call batch to the existing fallback", async () => {
		const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (url) => {
			if (String(url).startsWith("https://primary.example/")) {
				return new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), { status: 500 });
			}
			return completedResponse(true);
		});
		await request(buildApp([deployment("primary"), deployment("secondary")], [{ primary: ["secondary"] }]))
			.post("/v1/responses")
			.send({
				model: "primary",
				stream: true,
				tools,
				input: [
					{ role: "user", content: "Read both values." },
					functionCall("call_A"),
					functionCall("call_B"),
					output("call_A"),
					output("call_B"),
				],
			})
			.expect(200);

		expect(fetchSpy).toHaveBeenCalledTimes(2);
		for (const [, init] of fetchSpy.mock.calls) {
			expect(JSON.parse(String(init?.body)).messages).toEqual([
				{ role: "user", content: "Read both values." },
				{ role: "assistant", content: null, tool_calls: [chatCall("call_A"), chatCall("call_B")] },
				chatOutput("call_A"),
				chatOutput("call_B"),
			]);
		}
	});

	test("keeps the original items on a native Responses deployment", async () => {
		const model = deployment("native");
		model.litellm_params.model = "deepseek/deepseek-v4-flash";
		model.litellm_params.custom_llm_provider = "deepseek";
		const input = [
			{ type: "message", role: "user", content: "Read both values." },
			functionCall("call_A"),
			functionCall("call_B"),
			output("call_B"),
			output("call_A"),
		];
		const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "resp_native_history",
					object: "response",
					created_at: 1,
					model: "deepseek-v4-flash",
					status: "completed",
					output: [],
				}),
				{ headers: { "content-type": "application/json" } },
			),
		);

		await request(buildApp([model]))
			.post("/v1/responses")
			.send({ model: "native", store: false, tools, input })
			.expect(200);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
		expect(body.messages).toBeUndefined();
		// 官方 /responses 在工具循环里要求当前轮回显推理：这里只补一条结构占位，其余条目顺序不变。
		expect(body.input).toEqual([
			input[0],
			{ type: "reasoning", content: [{ type: "reasoning_text", text: "(reasoning omitted)" }] },
			...input.slice(1),
		]);
	});

	test("preserves an upstream error for a missing result without inventing or dropping history", async () => {
		const fetchSpy = jest
			.spyOn(global, "fetch")
			.mockResolvedValue(
				new Response(
					JSON.stringify({ error: { message: "No tool output found for function call call_A.", type: "invalid_request_error" } }),
					{ status: 400 },
				),
			);
		await request(buildApp([deployment("primary")]))
			.post("/v1/responses")
			.send({
				model: "primary",
				tools,
				input: [{ role: "user", content: "Read both values." }, functionCall("call_A"), functionCall("call_B"), output("call_B")],
			})
			.expect(400);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
		expect(body.messages).toEqual([
			{ role: "user", content: "Read both values." },
			{ role: "assistant", content: null, tool_calls: [chatCall("call_A"), chatCall("call_B")] },
			chatOutput("call_B"),
		]);
	});
});
