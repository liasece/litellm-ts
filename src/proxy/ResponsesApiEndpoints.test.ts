import http from "node:http";
import express from "express";
import request from "supertest";
import { ApiError } from "../core/api/ApiError";
import { Router } from "../router/Router";
import type { Router as LiteLLMRouter } from "../router/Router";
import { RoutingStrategyName, type Deployment } from "../types/router";
import { createEndpointSpendLifecycle } from "../spend/SpendReservation";
import * as SpendTracker from "../spend/SpendTracker";
import { registerResponsesApiRoutes } from "./ResponsesApiEndpoints";

function buildRouter(completion: jest.Mock): LiteLLMRouter {
	return {
		completion: completion,
		getDeployments: () => [
			{
				model_name: "responses-model",
				litellm_params: {
					model: "openai/provider-model",
					input_cost_per_token: 0.001,
					output_cost_per_token: 0.002,
				},
			},
		],
		getFallbacks: () => ({ "responses-model": ["fallback-model"] }),
	} as unknown as LiteLLMRouter;
}

function deployment(modelName: string, apiBase: string): Deployment {
	return {
		model_name: modelName,
		litellm_params: {
			model: "openai/provider-model",
			api_key: "test-key",
			api_base: apiBase,
			input_cost_per_token: 0.001,
			output_cost_per_token: 0.002,
		},
		model_info: { id: `${modelName}-deployment` },
	};
}

function buildDeploymentRouter(modelList: Deployment[], fallbacks: Array<Record<string, string[]>> = []): Router {
	return new Router({
		model_list: modelList,
		routing_strategy: RoutingStrategyName.SimpleShuffle,
		num_retries: 0,
		fallbacks: fallbacks,
	});
}

function buildApp(router: LiteLLMRouter, authenticated = false): express.Express {
	const app = express();
	app.use(express.json());
	if (authenticated) {
		app.use((req, _res, next) => {
			req.auth = {
				api_key: "sk-test",
				user_id: "user-1",
				budget_snapshots: { key: { id: "sk-test", spend: 0, max_budget: 10 } },
			} as never;
			next();
		});
	}
	const expressRouter = express.Router();
	registerResponsesApiRoutes(expressRouter, router, {} as never);
	app.use(expressRouter);
	return app;
}

function parseSseEvents(body: string): Array<Record<string, unknown>> {
	return body
		.split("\n\n")
		.map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
		.filter((line): line is string => line !== undefined)
		.map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

describe("Responses API contract matrix", () => {
	test("shared endpoint lifecycle commits only one terminal accounting action", async () => {
		const stop = jest.fn();
		const markProviderStarted = jest.fn();
		const lifecycle = createEndpointSpendLifecycle({
			requestId: "request-1",
			heartbeat: { stop: stop, markProviderStarted: markProviderStarted, renewNow: jest.fn() },
		});
		const accounting = jest.fn().mockResolvedValue(undefined);

		expect(lifecycle.isFinalized()).toBe(false);
		lifecycle.markProviderStarted();
		const finalizing = lifecycle.finalize(accounting);
		expect(lifecycle.isFinalized()).toBe(true);
		await Promise.all([finalizing, lifecycle.finalize(accounting)]);
		lifecycle.stop();

		expect(markProviderStarted).toHaveBeenCalledTimes(1);
		expect(accounting).toHaveBeenCalledTimes(1);
		expect(stop).toHaveBeenCalledTimes(1);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe("controlled deployment matrix", () => {
		test("non-stream deployment preserves tool, reasoning and cache usage contracts", async () => {
			const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
				new Response(
					JSON.stringify({
						id: "chatcmpl-deployment",
						object: "chat.completion",
						created: 1_700_000_001,
						model: "provider-model",
						choices: [
							{
								index: 0,
								finish_reason: "tool_calls",
								message: {
									role: "assistant",
									content: null,
									reasoning_content: "inspect",
									tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":1}' } }],
								},
							},
						],
						usage: {
							prompt_tokens: 9,
							completion_tokens: 5,
							total_tokens: 14,
							prompt_tokens_details: { cached_tokens: 3 },
							completion_tokens_details: { reasoning_tokens: 2 },
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);
			const app = buildApp(buildDeploymentRouter([deployment("responses-model", "https://primary.example/v1")]));

			const response = await request(app)
				.post("/v1/responses")
				.send({
					model: "responses-model",
					input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
					tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }],
				})
				.expect(200);

			const providerBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
			expect(providerBody).toMatchObject({
				model: "provider-model",
				messages: [{ role: "user", content: "hello" }],
				tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
			});
			expect(response.body.output.map((item: { type: string }) => item.type)).toEqual(["reasoning", "function_call"]);
			expect(response.body.usage).toEqual({
				input_tokens: 9,
				input_tokens_details: { cached_tokens: 3 },
				output_tokens: 5,
				output_tokens_details: { reasoning_tokens: 2 },
				total_tokens: 14,
			});
		});

		test("stream deployment parser emits standard ordered Responses events", async () => {
			const upstream = [
				'data: {"id":"chatcmpl-live","object":"chat.completion.chunk","created":1,"model":"provider-model","choices":[{"index":0,"delta":{"reasoning_content":"think","content":"Hi"},"finish_reason":null}]}\n',
				'data: {"id":"chatcmpl-live","object":"chat.completion.chunk","created":1,"model":"provider-model","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6,"prompt_tokens_details":{"cached_tokens":1}}}\n',
				"data: [DONE]\n",
			];
			jest.spyOn(global, "fetch").mockResolvedValue(
				new Response(
					new ReadableStream({
						start: (controller) => {
							for (const chunk of upstream) {
								controller.enqueue(new TextEncoder().encode(chunk));
							}
							controller.close();
						},
					}),
					{ status: 200, headers: { "content-type": "text/event-stream" } },
				),
			);
			const app = buildApp(buildDeploymentRouter([deployment("responses-model", "https://stream.example/v1")]));

			const response = await request(app)
				.post("/v1/responses")
				.send({ model: "responses-model", input: "hello", stream: true })
				.expect(200);
			const events = parseSseEvents(response.text);
			expect(events.map((event) => event.type).slice(0, 2)).toEqual(["response.created", "response.in_progress"]);
			expect(events.map((event) => event.type).at(-1)).toBe("response.completed");
			expect(events.filter((event) => event.type === "response.completed" || event.type === "response.failed")).toHaveLength(1);
		});

		test("deployment fallback stays inside Router and returns one final response", async () => {
			const fetchSpy = jest
				.spyOn(global, "fetch")
				.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "primary failed" } }), { status: 500 }))
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({
							id: "chatcmpl-fallback",
							model: "fallback-provider-model",
							choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }],
							usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					),
				);
			const router = buildDeploymentRouter(
				[deployment("primary-model", "https://primary.example/v1"), deployment("fallback-model", "https://fallback.example/v1")],
				[{ "primary-model": ["fallback-model"] }],
			);
			const app = buildApp(router);

			const response = await request(app).post("/v1/responses").send({ model: "primary-model", input: "hello" }).expect(200);
			expect(fetchSpy).toHaveBeenCalledTimes(2);
			expect(response.body.output[0]).toMatchObject({ type: "message", content: [{ type: "output_text", text: "ok" }] });
		});

		test("deployment terminal provider error preserves HTTP code", async () => {
			jest.spyOn(global, "fetch").mockResolvedValue(
				new Response(JSON.stringify({ error: { message: "rate limited" } }), {
					status: 429,
					headers: { "content-type": "application/json" },
				}),
			);
			const app = buildApp(buildDeploymentRouter([deployment("responses-model", "https://error.example/v1")]));

			await request(app).post("/v1/responses").send({ model: "responses-model", input: "hello" }).expect(429);
		});
	});

	test("maps typed input, instructions and function tools without JSON stringifying the request", async () => {
		const completion = jest.fn().mockResolvedValue({
			id: "chatcmpl-provider",
			object: "chat.completion",
			created: 1_700_000_000,
			model: "provider-fallback-model",
			choices: [
				{
					index: 0,
					finish_reason: "tool_calls",
					message: {
						role: "assistant",
						content: "Calling weather",
						reasoning_content: "Need current conditions",
						thinking_blocks: [{ type: "thinking", thinking: "Check location", signature: "sig" }],
						tool_calls: [{ id: "call_1", type: "function", function: { name: "weather", arguments: '{"city":"Paris"}' } }],
					},
				},
			],
			usage: {
				prompt_tokens: 12,
				completion_tokens: 7,
				total_tokens: 19,
				prompt_tokens_details: { cached_tokens: 4 },
				completion_tokens_details: { reasoning_tokens: 3 },
			},
			_fallbackDepth: 1,
		});
		const app = buildApp(buildRouter(completion));

		const response = await request(app)
			.post("/v1/responses")
			.send({
				model: "responses-model",
				instructions: "Be concise",
				input: [
					{ type: "message", role: "user", content: [{ type: "input_text", text: "Weather?" }] },
					{ type: "function_call", call_id: "call_old", name: "lookup", arguments: '{"q":1}' },
					{ type: "function_call_output", call_id: "call_old", output: { weather: "sunny" } },
				],
				max_output_tokens: 128,
				reasoning: { effort: "medium" },
				tools: [{ type: "function", name: "weather", description: "Get weather", parameters: { type: "object" }, strict: true }],
			})
			.expect(200);

		expect(completion).toHaveBeenCalledWith(
			"responses-model",
			[
				{ role: "developer", content: "Be concise" },
				{ role: "user", content: "Weather?" },
				{
					role: "assistant",
					content: null,
					tool_calls: [{ id: "call_old", type: "function", function: { name: "lookup", arguments: '{"q":1}' } }],
				},
				{ role: "tool", tool_call_id: "call_old", content: '{"weather":"sunny"}' },
			],
			expect.objectContaining({
				max_completion_tokens: 128,
				reasoning_effort: "medium",
				tools: [
					{
						type: "function",
						function: { name: "weather", description: "Get weather", parameters: { type: "object" }, strict: true },
					},
				],
			}),
		);
		expect(completion.mock.calls[0]?.[1][1].content).not.toContain("input_text");
		expect(response.body).toMatchObject({
			id: "resp_provider",
			object: "response",
			status: "completed",
			error: null,
			model: "provider-fallback-model",
			usage: {
				input_tokens: 12,
				input_tokens_details: { cached_tokens: 4 },
				output_tokens: 7,
				output_tokens_details: { reasoning_tokens: 3 },
				total_tokens: 19,
			},
		});
		expect(response.body.output.map((item: { type: string }) => item.type)).toEqual(["reasoning", "message", "function_call"]);
	});

	test.each(["get", "delete"] as const)("%s response storage route is explicitly not implemented", async (method) => {
		const app = buildApp(buildRouter(jest.fn()));
		const response = await request(app)[method]("/v1/responses/resp_123").expect(501);
		expect(response.body.error).toMatchObject({ code: "501", type: "not_implemented" });
	});

	test("emits ordered standard SSE events and exactly one completed terminal event", async () => {
		async function* stream() {
			yield {
				id: "chatcmpl-stream",
				model: "provider-model",
				choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "think", content: "Hel" }, finish_reason: null }],
			};
			yield {
				id: "chatcmpl-stream",
				model: "provider-model",
				choices: [
					{
						index: 0,
						delta: {
							content: "lo",
							tool_calls: [
								{ index: 0, id: "call_1", type: "function", function: { name: "weather", arguments: '{"city":' } },
							],
						},
						finish_reason: null,
					},
				],
			};
			yield {
				id: "chatcmpl-stream",
				model: "provider-model",
				choices: [
					{
						index: 0,
						delta: { tool_calls: [{ index: 0, function: { arguments: '"Paris"}' } }] },
						finish_reason: "tool_calls",
					},
				],
				usage: {
					prompt_tokens: 5,
					completion_tokens: 4,
					total_tokens: 9,
					prompt_tokens_details: { cached_tokens: 2 },
					completion_tokens_details: { reasoning_tokens: 1 },
				},
			};
		}
		const completion = jest.fn().mockResolvedValue({
			_stream: true,
			stream: stream(),
			_spendInfo: { deploymentModel: "openai/provider-model" },
		});
		const app = buildApp(buildRouter(completion));

		const response = await request(app)
			.post("/v1/responses")
			.send({ model: "responses-model", input: "hello", stream: true })
			.expect(200);
		const events = parseSseEvents(response.text);
		const eventTypes = events.map((event) => event.type);
		expect(eventTypes.slice(0, 2)).toEqual(["response.created", "response.in_progress"]);
		expect(eventTypes).toContain("response.reasoning_text.delta");
		expect(eventTypes).toContain("response.output_text.delta");
		expect(eventTypes).toContain("response.function_call_arguments.delta");
		expect(eventTypes.at(-1)).toBe("response.completed");
		expect(eventTypes.filter((type) => type === "response.completed" || type === "response.failed")).toHaveLength(1);
		expect(events.map((event) => event.sequence_number)).toEqual(events.map((_event, index) => index));
		expect((events.at(-1)?.response as Record<string, unknown>).usage).toEqual({
			input_tokens: 5,
			input_tokens_details: { cached_tokens: 2 },
			output_tokens: 4,
			output_tokens_details: { reasoning_tokens: 1 },
			total_tokens: 9,
		});
	});

	test.each([
		[
			"malformed event",
			async function* () {
				yield { unexpected: true };
			},
		],
		[
			"provider timeout",
			async function* () {
				throw Object.assign(new Error("provider timeout"), { name: "AbortError" });
			},
		],
	] as const)("stream %s emits one failed terminal and records failure once", async (_name, streamFactory) => {
		jest.spyOn(SpendTracker, "reserveSpend").mockResolvedValue({
			status: "reserved",
			requestId: "request-1",
			reserved: 1,
			actual: null,
		});
		const trackSpy = jest
			.spyOn(SpendTracker, "trackSpendLog")
			.mockResolvedValue({ status: "committed", requestId: "request-1", spend: 0 });
		const completion = jest.fn().mockResolvedValue({ _stream: true, stream: streamFactory() });
		const app = buildApp(buildRouter(completion), true);

		const response = await request(app)
			.post("/v1/responses")
			.send({ model: "responses-model", input: "hello", stream: true })
			.expect(200);
		const events = parseSseEvents(response.text);
		expect(events.filter((event) => event.type === "response.completed" || event.type === "response.failed")).toHaveLength(1);
		expect(events.at(-1)?.type).toBe("response.failed");
		expect(trackSpy).toHaveBeenCalledTimes(1);
		expect(trackSpy.mock.calls[0]?.[1]).toMatchObject({ status: "failure" });
	});

	test("client abort interrupts a pending stream and records one failure", async () => {
		jest.spyOn(SpendTracker, "reserveSpend").mockResolvedValue({
			status: "reserved",
			requestId: "request-1",
			reserved: 1,
			actual: null,
		});
		let accountingCompleted!: () => void;
		const accounted = new Promise<void>((resolve) => {
			accountingCompleted = resolve;
		});
		const trackSpy = jest.spyOn(SpendTracker, "trackSpendLog").mockImplementation(async () => {
			accountingCompleted();
			return { status: "committed", requestId: "request-1", spend: 0 };
		});
		async function* pendingStream() {
			yield {
				id: "chatcmpl-abort",
				model: "provider-model",
				choices: [{ index: 0, delta: { content: "first" }, finish_reason: null }],
			};
			await new Promise<never>(() => undefined);
		}
		const app = buildApp(buildRouter(jest.fn().mockResolvedValue({ _stream: true, stream: pendingStream() })), true);
		const server = app.listen(0);
		try {
			const address = server.address();
			if (!address || typeof address === "string") {
				throw new Error("test server address unavailable");
			}
			await new Promise<void>((resolve, reject) => {
				const client = http.request(
					{
						host: "127.0.0.1",
						port: address.port,
						path: "/v1/responses",
						method: "POST",
						headers: { "content-type": "application/json" },
					},
					(response) => {
						response.once("data", () => {
							response.destroy();
							resolve();
						});
					},
				);
				client.once("error", reject);
				client.end(JSON.stringify({ model: "responses-model", input: "hello", stream: true }));
			});
			await accounted;
			expect(trackSpy).toHaveBeenCalledTimes(1);
			expect(trackSpy.mock.calls[0]?.[1]).toMatchObject({ status: "failure" });
		} finally {
			server.close();
		}
	});

	test("router fallback failure is returned with its original error code and accounted once", async () => {
		jest.spyOn(SpendTracker, "reserveSpend").mockResolvedValue({
			status: "reserved",
			requestId: "request-1",
			reserved: 1,
			actual: null,
		});
		const trackSpy = jest
			.spyOn(SpendTracker, "trackSpendLog")
			.mockResolvedValue({ status: "committed", requestId: "request-1", spend: 0 });
		const error = ApiError.tooManyRequests("all deployments failed");
		const completion = jest.fn().mockRejectedValue(error);
		const app = buildApp(buildRouter(completion), true);

		await request(app).post("/v1/responses").send({ model: "responses-model", input: "hello" }).expect(429);
		expect(trackSpy).toHaveBeenCalledTimes(1);
		expect(trackSpy.mock.calls[0]?.[1]).toMatchObject({ status: "failure" });
	});
});
