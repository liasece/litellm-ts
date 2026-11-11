import http from "node:http";
import express from "express";
import request from "supertest";
import { ApiError } from "../core/api/ApiError";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import { Router } from "../router/Router";
import type { Router as LiteLLMRouter } from "../router/Router";
import { RoutingStrategyName, type Deployment } from "../types/router";
import { createEndpointSpendLifecycle } from "../spend/SpendReservation";
import * as SpendTracker from "../spend/SpendTracker";
import { upstreamExchangeScope } from "../middleware/UpstreamExchangeScope";
import { registerResponsesApiRoutes } from "./ResponsesApiEndpoints";
import { registerChatCompletionsRoutes } from "./ChatCompletionsEndpoint";
import { setSubscriptionRequestHandler } from "../router/SubscriptionDispatch";

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

function deepseekDeployment(modelName = "deepseek-v4-flash", apiBase = "https://api.deepseek.com"): Deployment {
	return {
		model_name: modelName,
		litellm_params: {
			model: "deepseek/deepseek-v4-flash",
			custom_llm_provider: "deepseek",
			api_key: "deepseek-key",
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

function buildApp(router: LiteLLMRouter, authenticated = false, database: unknown = {}): express.Express {
	const app = express();
	// 与生产装配一致：请求级上游交换作用域在任何路由之前建立。
	app.use(upstreamExchangeScope);
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
	registerResponsesApiRoutes(expressRouter, router, database === null ? undefined : (database as never));
	app.use(expressRouter);
	return app;
}

/**
 * 旧测试只验证端点行为：订阅桥用透传桩代替真实运行时，让 fetch mock 继续观察上游。
 */
function installBridgeStub(): void {
	setSubscriptionRequestHandler(async (request) => {
		const init: RequestInit = { method: request.method, headers: request.headers };
		if (request.body !== undefined) {
			init.body = request.bodyEncoding === "raw" ? String(request.body) : JSON.stringify(request.body);
		}
		const response = await globalThis.fetch("https://bridge.test/v1/responses", init);
		const contentType = response.headers.get("content-type") ?? "";
		const body = contentType.includes("application/json") ? ((await response.clone().json()) as unknown) : undefined;
		return { response: response, body: body, latencyMs: 0, startedAtMs: Date.now() };
	});
}

function parseSseEvents(body: string): Array<Record<string, unknown>> {
	return body
		.split("\n\n")
		.map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
		.filter((line): line is string => line !== undefined)
		.map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

/** 原生 Responses 上游流式帧：能力主轮走原生协议后，测试替身必须按该协议应答。 */
function nativeResponsesSse(options: {
	id: string;
	text: string;
	usage: Record<string, unknown>;
	model?: string;
	reasoning?: string;
}): string {
	const event = (type: string, payload: Record<string, unknown>): string =>
		`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
	const model = options.model ?? "deepseek-v4-flash";
	const chunks = [
		event("response.created", { response: { id: options.id, object: "response", model, status: "in_progress" } }),
	];
	if (options.reasoning !== undefined) {
		chunks.push(
			event("response.reasoning_summary_text.delta", {
				item_id: `rs_${options.id}`,
				output_index: 0,
				delta: options.reasoning,
			}),
		);
	}
	chunks.push(
		event("response.output_text.delta", { item_id: `msg_${options.id}`, output_index: 0, content_index: 0, delta: options.text }),
	);
	chunks.push(
		event("response.completed", {
			response: {
				id: options.id,
				object: "response",
				model,
				status: "completed",
				output: [
					{
						id: `msg_${options.id}`,
						type: "message",
						role: "assistant",
						status: "completed",
						content: [{ type: "output_text", text: options.text, annotations: [] }],
					},
				],
				usage: options.usage,
			},
		}),
	);
	chunks.push("data: [DONE]\n\n");
	return chunks.join("");
}

describe("Responses API contract matrix", () => {
	beforeEach(() => {
		installBridgeStub();
	});

	afterEach(() => {
		setSubscriptionRequestHandler(undefined);
	});

	test("Codex can resend a legacy router image through create and input_tokens without passing a local ID to the provider", async () => {
		const result = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jcLkAAAAASUVORK5CYII=";
		const localImage = { type: "image_generation_call", id: "imggen_" + "a".repeat(32), status: "completed", result };
		const input = [
			{ type: "message", role: "user", content: "Draw" },
			localImage,
			{ type: "function_call", call_id: "call_read", name: "read", arguments: "{}" },
			{ type: "function_call_output", call_id: "call_read", output: "ok" },
			{ type: "message", role: "user", content: "Continue" },
		];
		const completed = jest.fn().mockResolvedValue({
			id: "completion",
			model: "responses-model",
			choices: [{ message: { role: "assistant", content: "Ready" }, finish_reason: "stop" }],
		});
		const app = buildApp(buildRouter(completed), false, null);
		const body = { model: "responses-model", input };
		const counted = await request(app).post("/v1/responses/input_tokens").send(body).expect(200);
		expect(counted.body.input_tokens).toBeGreaterThan(0);
		const reply = await request(app).post("/v1/responses").send(body).expect(200);
		expect(reply.body.output.map((item: { type: string }) => item.type)).toEqual(["message"]);
		const [, messages, params] = completed.mock.calls[0]!;
		expect(messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "tool", "user", "user"]);
		expect(JSON.stringify(params)).not.toContain(localImage.id);
		expect(messages[3].content[1].image_url.url).toBe("data:image/png;base64," + result);
		for (const endpoint of ["/v1/responses", "/v1/responses/input_tokens"]) {
			await request(app)
				.post(endpoint)
				.send({ ...body, input: [{ ...localImage, result: null }] })
				.expect(400);
			await request(app)
				.post(endpoint)
				.send({ ...body, input: [{ ...localImage, result: "YWJj" }] })
				.expect(400);
			await request(app)
				.post(endpoint)
				.send({ ...body, input: [null] })
				.expect(400);
		}
	});

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
		test("MiniMax Responses streaming records input, output and cached tokens without client usage options", async () => {
			jest.spyOn(SpendTracker, "reserveSpend").mockResolvedValue({
				status: "reserved",
				requestId: "request-minimax-usage",
				reserved: 1,
				actual: null,
			});
			const trackSpy = jest.spyOn(SpendTracker, "trackSpendLog").mockResolvedValue({
				status: "committed",
				requestId: "request-minimax-usage",
				spend: 0,
			});
			jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
				const body = JSON.parse(String(init?.body));
				const streamOptions = body["stream_options"];
				const chunks: Record<string, unknown>[] = [
					{
						id: "chatcmpl-minimax-usage",
						object: "chat.completion.chunk",
						created: 1,
						model: "MiniMax-M3.1-Flash",
						choices: [{ index: 0, delta: { content: "OK" }, finish_reason: "stop" }],
					},
				];
				// MiniMax only includes its final usage chunk when the upstream request opts in.
				if (streamOptions?.["include_usage"] === true) {
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
			const model = deployment("minimax-latest-anthropic", "https://api.minimaxi.com/v1");
			model.litellm_params.model = "minimax/MiniMax-M3.1-Flash";
			const app = buildApp(buildDeploymentRouter([model]), true);
			const response = await request(app)
				.post("/v1/responses")
				.send({
				model: "minimax-latest-anthropic",
				input: "Return OK",
				stream: true,
			})
				.expect(200);
			const terminal = parseSseEvents(response.text).at(-1);
			expect(terminal).toMatchObject({
				type: "response.completed",
				response: {
					usage: { input_tokens: 1200, output_tokens: 30, total_tokens: 1230, input_tokens_details: { cached_tokens: 1024 } },
				},
			});
			expect(trackSpy).toHaveBeenCalledTimes(1);
			expect(trackSpy.mock.calls[0]?.[1]).toMatchObject({
				status: "success",
				prompt_tokens: 1200,
				completion_tokens: 30,
				total_tokens: 1230,
				cache_read_input_tokens: 1024,
			});
		});

		test.each([false, true])("CLIProxy builtin Responses preserves cache usage in client output and accounting (stream=%s)", async (stream) => {
			jest.spyOn(dbConfigProvider, "getParam").mockImplementation(async (param) => param === "builtin_capabilities" ? { web: { enabled: true, handler_model: "web-worker", max_iterations: 3 } } : {});
			jest.spyOn(SpendTracker, "reserveSpend").mockResolvedValue({
				status: "reserved",
				requestId: "request-cliproxy-cache",
				reserved: 1,
				actual: null,
			});
			jest.spyOn(SpendTracker, "checkpointActiveRequest").mockResolvedValue(true);
			const trackSpy = jest.spyOn(SpendTracker, "trackSpendLog").mockResolvedValue({
				status: "committed",
				requestId: "request-cliproxy-cache",
				spend: 0,
			});
			const upstreamResponse = {
				id: "resp_cliproxy_cache",
				object: "response",
				created_at: 1_700_000_100,
				status: "completed",
				model: "deepseek-v4.1-flash",
				output: [
					{
						id: "msg_cache",
						type: "message",
						status: "completed",
						role: "assistant",
						content: [{ type: "output_text", text: "OK", annotations: [] }],
					},
				],
				usage: {
					input_tokens: 187969,
					output_tokens: 932,
					total_tokens: 188901,
					input_tokens_details: { cached_tokens: 187392 },
					output_tokens_details: { reasoning_tokens: 17 },
				},
			};
			const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
				const streaming = JSON.parse(String(init?.body ?? "{}")).stream === true;
				if (!streaming) {
					return new Response(JSON.stringify(upstreamResponse), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				return new Response(
					nativeResponsesSse({ id: "resp_cap_cache", text: "OK", model: "deepseek-v4.1-flash", usage: upstreamResponse.usage }),
					{ status: 200, headers: { "content-type": "text/event-stream" } },
				);
			});
			const nativeDeployment = {
				model_name: "cliproxy-cached",
				litellm_params: {
					model: "deepseek-v4.1-flash",
					custom_llm_provider: "opencode-go",
					input_cost_per_token: 1.5e-7,
					output_cost_per_token: 6e-7,
					cache_read_input_token_cost: 1.5e-8,
				},
				model_info: { id: "cliproxy-cache-deployment", supports_function_calling: true, enabled_builtin_capabilities: ["web"] },
			};
			const app = buildApp(buildDeploymentRouter([nativeDeployment]), true);
			const response = await request(app)
				.post("/v1/responses")
				.send({ model: "cliproxy-cached", input: "Return OK.", store: false, stream: stream })
				.expect(200);
			const clientResponse = (stream ? parseSseEvents(response.text).at(-1)?.response : response.body) as Record<string, unknown>;
			expect(clientResponse).toMatchObject({
				usage: {
					input_tokens: 187969,
					output_tokens: 932,
					total_tokens: 188901,
					input_tokens_details: { cached_tokens: 187392 },
					output_tokens_details: { reasoning_tokens: 17 },
				},
			});
			expect(fetchSpy).toHaveBeenCalledTimes(1);
			expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)).stream).toBe(stream);
			expect(trackSpy).toHaveBeenCalledTimes(1);
			const log = trackSpy.mock.calls[0]?.[1] as unknown as {
			model: string;
			custom_cost_per_token?: Record<string, number>;
			usage?: Record<string, unknown>;
		};
			expect(log).toMatchObject({
				prompt_tokens: 187969,
				completion_tokens: 932,
				cache_read_input_tokens: 187392,
				metadata: { additional_usage_values: { cache_read_input_tokens: 187392 } },
			});
			const accountingResponse = { usage: log.usage } as unknown as import("../types/openai").ModelResponse;
			SpendTracker.calculateAndSetCost(accountingResponse, log.model, log.custom_cost_per_token);
			const expectedCost = 577 * 1.5e-7 + 915 * 6e-7 + 187392 * 1.5e-8;
			expect(accountingResponse.usage?.cost).toBeCloseTo(expectedCost, 10);
			if (!stream) {
				expect((clientResponse.usage as Record<string, unknown>).cost).toBeCloseTo(expectedCost, 10);
			}
		});

		test("native Responses keeps the source image and its permanent reference together", async () => {
			jest.spyOn(dbConfigProvider, "getParam").mockImplementation(async (param) =>
				param === "builtin_capabilities"
					? {
							image_generation: {
								enabled: true,
								always_inject: true,
								handler_model: "image-worker",
								fallback_models: [],
								max_iterations: 3,
							},
						}
					: {},
			);
			jest.spyOn(SpendTracker, "reserveSpend").mockResolvedValue({
				status: "reserved",
				requestId: "request-cliproxy-tail",
				reserved: 1,
				actual: null,
			});
			jest.spyOn(SpendTracker, "checkpointActiveRequest").mockResolvedValue(true);
			jest.spyOn(SpendTracker, "trackSpendLog").mockResolvedValue({
				status: "committed",
				requestId: "request-cliproxy-tail",
				spend: 0,
			});
			const bodies: Record<string, unknown>[] = [];
			jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
				bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
				return new Response(
					JSON.stringify({
						id: "resp_native_tail",
						object: "response",
						created_at: 1,
						status: "completed",
						model: "deepseek-v4.1-flash",
						output: [
							{
								id: "msg_tail",
								type: "message",
								status: "completed",
								role: "assistant",
								content: [{ type: "output_text", text: "OK", annotations: [] }],
							},
						],
						usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			});
			const nativeDeployment = {
				model_name: "cliproxy-tail",
				litellm_params: {
					model: "deepseek-v4.1-flash",
					custom_llm_provider: "opencode-go",
				},
				model_info: { id: "cliproxy-tail-deployment", enabled_builtin_capabilities: ["image_generation"] },
			};
			const app = buildApp(buildDeploymentRouter([nativeDeployment]), true, null);
			await request(app)
				.post("/v1/responses")
				.send({
					model: "cliproxy-tail",
					store: false,
					instructions: "Inspect the original screenshot.",
					input: [
						{
							type: "message",
							role: "user",
							content: [
								{ type: "input_text", text: "Describe this screenshot." },
								{ type: "input_image", image_url: "data:image/png;base64,YWJj" },
							],
						},
					],
				})
				.expect(200);

			expect(bodies).toHaveLength(1);
			const forwarded = bodies[0]!["input"] as Record<string, unknown>[];
			expect(bodies[0]!.instructions).toBe("Inspect the original screenshot.");
			expect(forwarded).toHaveLength(1);
			expect(forwarded[0]).toMatchObject({
				type: "message",
				role: "user",
				content: [
					{ type: "input_text", text: "Describe this screenshot." },
					{ type: "input_image", image_url: "data:image/png;base64,YWJj" },
					{ type: "input_text", text: expect.stringMatching(/sha256:[a-f0-9]{64}/) },
				],
			});
		});

		test("CLIProxy streaming Responses keeps the native Responses transport", async () => {
			jest.spyOn(SpendTracker, "reserveSpend").mockResolvedValue({
				status: "reserved",
				requestId: "request-cliproxy-native",
				reserved: 1,
				actual: null,
			});
			jest.spyOn(SpendTracker, "checkpointActiveRequest").mockResolvedValue(true);
			jest.spyOn(SpendTracker, "trackSpendLog").mockResolvedValue({
				status: "committed",
				requestId: "request-cliproxy-native",
				spend: 0,
			});
			const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
				new Response(
					nativeResponsesSse({
						id: "resp_cliproxy_native",
						text: "OK",
						usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
					}),
					{ status: 200, headers: { "content-type": "text/event-stream" } },
				),
			);
			const deployment = {
				model_name: "cliproxy-native",
				litellm_params: { model: "deepseek-v4.1-flash", custom_llm_provider: "opencode-go" },
				model_info: { id: "cliproxy-native-deployment" },
			};
			const app = buildApp(buildDeploymentRouter([deployment]), true);

			const response = await request(app)
				.post("/v1/responses")
				.send({ model: "cliproxy-native", input: "Return OK.", store: false, stream: true })
				.expect(200);

			expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/responses");
			expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain("/chat/completions");
			const providerBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
			expect(providerBody["stream"]).toBe(true);
			expect(providerBody["input"]).toBeDefined();
			const events = parseSseEvents(response.text);
			expect(events.at(-1)).toMatchObject({ type: "response.completed" });
		});

		test("capability main turn relays upstream reasoning to the client", async () => {
			jest.spyOn(dbConfigProvider, "getParam").mockImplementation(async (param) =>
				param === "builtin_capabilities"
					? {
							vision: {
								enabled: true,
								always_inject: true,
								handler_model: "vision-worker",
								fallback_models: [],
								max_iterations: 3,
								max_output_tokens: 1024,
							},
						}
					: {},
			);
			jest.spyOn(SpendTracker, "reserveSpend").mockResolvedValue({
				status: "reserved",
				requestId: "request-reasoning",
				reserved: 1,
				actual: null,
			});
			jest.spyOn(SpendTracker, "checkpointActiveRequest").mockResolvedValue(true);
			jest.spyOn(SpendTracker, "trackSpendLog").mockResolvedValue({
				status: "committed",
				requestId: "request-reasoning",
				spend: 0,
			});
			jest.spyOn(global, "fetch").mockResolvedValue(
				new Response(
					nativeResponsesSse({
						id: "resp_reasoning",
						text: "OK",
						reasoning: "We need",
						usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
					}),
					{ status: 200, headers: { "content-type": "text/event-stream" } },
				),
			);
			const nativeDeployment = deepseekDeployment();
			nativeDeployment.model_info = {
				...nativeDeployment.model_info,
				supports_function_calling: true,
				enabled_builtin_capabilities: ["vision"],
			};
			const app = buildApp(buildDeploymentRouter([nativeDeployment]), true);

			const response = await request(app)
				.post("/v1/responses")
				.send({ model: "deepseek-v4-flash", input: "Return OK.", store: false, stream: true })
				.expect(200);

			const events = parseSseEvents(response.text);
			const reasoning = events
				.filter((event) => event.type === "response.reasoning_text.delta")
				.map((event) => String(event.delta ?? ""))
				.join("");
			expect(reasoning).toBe("We need");
		});

		test("DeepSeek Flash uses native Responses and preserves Responses semantics", async () => {
			jest.spyOn(SpendTracker, "reserveSpend").mockResolvedValue({
				status: "reserved",
				requestId: "request-native",
				reserved: 1,
				actual: null,
			});
			const trackSpy = jest
				.spyOn(SpendTracker, "trackSpendLog")
				.mockResolvedValue({ status: "committed", requestId: "request-native", spend: 0 });
			const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
				new Response(
					JSON.stringify({
						id: "resp_deepseek_native",
						object: "response",
						created_at: 1_700_000_100,
						status: "completed",
						model: "deepseek-v4-flash",
						output: [
							{
								id: "fc_native",
								type: "function_call",
								status: "completed",
								call_id: "call_native",
								name: "js",
								namespace: "mcp__node_repl",
								arguments: '{"code":"1+1"}',
							},
						],
						usage: {
							input_tokens: 12,
							input_tokens_details: { cached_tokens: 4 },
							output_tokens: 7,
							output_tokens_details: { reasoning_tokens: 3 },
							total_tokens: 19,
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);
			const app = buildApp(buildDeploymentRouter([deepseekDeployment()]), true);

			const reasoningItem = {
				id: "rs_history",
				type: "reasoning",
				summary: [],
				encrypted_content: "encrypted-history",
			};
			const response = await request(app)
				.post("/v1/responses")
				.send({
					model: "deepseek-v4-flash",
					instructions: "Follow instructions",
					input: [reasoningItem, { role: "user", content: "calculate" }],
					reasoning: { effort: "max" },
					tools: [
						{
							type: "namespace",
							name: "mcp__node_repl",
							tools: [{ type: "function", name: "js", parameters: { type: "object" } }],
						},
						{ type: "web_search", external_web_access: true },
					],
				})
				.expect(200);

			expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://api.deepseek.com/responses");
			const providerBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
			expect(providerBody).toMatchObject({
				model: "deepseek-v4-flash",
				instructions: "Follow instructions",
				input: [reasoningItem, { role: "user", content: "calculate" }],
				reasoning: { effort: "max" },
			});
			expect(providerBody["messages"]).toBeUndefined();
			expect(providerBody["tools"]).toEqual([
				{
					type: "namespace",
					name: "mcp__node_repl",
					tools: [{ type: "function", name: "js", parameters: { type: "object" } }],
				},
				{ type: "web_search", external_web_access: true },
			]);
			expect(response.body).toMatchObject({
				id: "resp_deepseek_native",
				object: "response",
				status: "completed",
				output: [
					{
						type: "function_call",
						call_id: "call_native",
						namespace: "mcp__node_repl",
						name: "js",
					},
				],
			});
			expect(response.body.usage.cost).toBeUndefined();
			expect(trackSpy).toHaveBeenCalledTimes(1);
			expect(trackSpy.mock.calls[0]?.[1]).toMatchObject({
				call_type: "aresponses",
				status: "success",
			});
		});

		test("DeepSeek native Responses stream is relayed without Chat synthesis", async () => {
			jest.spyOn(dbConfigProvider, "getParam").mockImplementation(async (param) =>
				param === "general_settings" ? { store_upstream_logs_in_spend_logs: true } : {},
			);
			jest.spyOn(SpendTracker, "reserveSpend").mockResolvedValue({
				status: "reserved",
				requestId: "request-native-stream",
				reserved: 1,
				actual: null,
			});
			const trackSpy = jest
				.spyOn(SpendTracker, "trackSpendLog")
				.mockResolvedValue({ status: "committed", requestId: "request-native-stream", spend: 0 });
			const upstream = [
				": keep-alive\r\n\r\n",
				'event: response.created\r\ndata: {"type":"response.created","sequence_number":0,"response":{"id":"resp_native_',
				'stream","object":"response","created_at":1700000100,"status":"in_progress","model":"deepseek-v4-flash","output":[]}}\r\n\r\n',
				'event: response.output_item.done\ndata: {"type":"response.output_item.done","sequence_number":1,"output_index":0,"item":{"id":"fc_stream","type":"function_call","status":"completed","call_id":"call_stream","name":"read_thread_terminal","namespace":"codex_app","arguments":"{}"}}\n\n',
				'event: response.completed\ndata: {"type":"response.completed","sequence_number":2,"response":{"id":"resp_native_stream","object":"response","created_at":1700000100,"status":"completed","model":"deepseek-v4-flash","output":[{"id":"fc_stream","type":"function_call","status":"completed","call_id":"call_stream","name":"read_thread_terminal","namespace":"codex_app","arguments":"{}"}],"usage":{"input_tokens":5,"input_tokens_details":{"cached_tokens":1},"output_tokens":2,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":7}}}\n\n',
			];
			const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
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
			const app = buildApp(buildDeploymentRouter([deepseekDeployment()]), true);

			const response = await request(app)
				.post("/v1/responses")
				.send({
					model: "deepseek-v4-flash",
					input: "read terminal",
					stream: true,
					tools: [
						{
							type: "namespace",
							name: "codex_app",
							tools: [{ type: "function", name: "read_thread_terminal", parameters: { type: "object" } }],
						},
					],
				})
				.expect(200);

			expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://api.deepseek.com/responses");
			const providerBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
			expect(providerBody["input"]).toBe("read terminal");
			expect(providerBody["messages"]).toBeUndefined();
			expect(providerBody["tools"]).toEqual([
				{
					type: "namespace",
					name: "codex_app",
					tools: [{ type: "function", name: "read_thread_terminal", parameters: { type: "object" } }],
				},
			]);
			const events = parseSseEvents(response.text);
			expect(events.map((event) => event["type"])).toEqual(["response.created", "response.output_item.done", "response.completed"]);
			expect(events[1]?.["item"]).toMatchObject({
				type: "function_call",
				namespace: "codex_app",
				name: "read_thread_terminal",
			});
			expect((events[2]?.["response"] as Record<string, unknown>)?.["output"]).toEqual([
				expect.objectContaining({ namespace: "codex_app", name: "read_thread_terminal" }),
			]);
			expect(trackSpy).toHaveBeenCalledTimes(1);
			expect(trackSpy.mock.calls[0]?.[1]).toMatchObject({
				proxy_server_request: {
					upstream_response: {
						body: {
							output: [
								expect.objectContaining({
									type: "function_call",
									namespace: "codex_app",
									name: "read_thread_terminal",
								}),
							],
						},
					},
				},
			});
		});

		test("DeepSeek native Responses injects always-on private capabilities without falling back to Chat", async () => {
			jest.spyOn(dbConfigProvider, "getParam").mockImplementation(async (param) =>
				param === "builtin_capabilities"
					? {
							vision: {
								enabled: true,
								always_inject: true,
								handler_model: "vision-worker",
								fallback_models: [],
								max_iterations: 3,
								max_output_tokens: 1024,
							},
						}
					: {},
			);
			const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
				new Response(
					JSON.stringify({
						id: "resp_native_capability_bypass",
						object: "response",
						created_at: 1_700_000_100,
						status: "completed",
						model: "deepseek-v4-flash",
						output: [{ id: "msg_1", type: "message", status: "completed", role: "assistant", content: [] }],
						usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);
			const nativeDeployment = deepseekDeployment();
			nativeDeployment.model_info = {
				...nativeDeployment.model_info,
				supports_function_calling: true,
				enabled_builtin_capabilities: ["vision"],
			};
			const app = buildApp(buildDeploymentRouter([nativeDeployment]), false, null);
			const originalInput = [
				{
					id: "msg_user_history",
					role: "user",
					type: "message",
					content: [{ type: "input_text", text: "Return OK." }],
				},
				{
					id: "msg_assistant_history",
					role: "assistant",
					type: "message",
					content: [{ type: "output_text", text: "Earlier answer." }],
				},
				{
					id: "fc_history",
					type: "function_call",
					call_id: "call_history",
					name: "client_tool",
					arguments: "{}",
				},
				{
					id: "fco_history",
					type: "function_call_output",
					call_id: "call_history",
					output: "done",
				},
			];

			const response = await request(app)
				.post("/v1/responses")
				.send({
					model: "deepseek-v4-flash",
					input: originalInput,
					instructions: "Preserve the original Responses history.",
					store: false,
					tools: [
						{
							type: "function",
							name: "client_tool",
							description: "Client tool",
							parameters: { type: "object", properties: {} },
						},
					],
				})
				.expect(200);

			expect(response.body).toMatchObject({
				id: "resp_native_capability_bypass",
				object: "response",
				status: "completed",
			});
			expect(fetchSpy).toHaveBeenCalledTimes(1);
			const providerBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
			expect(providerBody["messages"]).toBeUndefined();
			expect(providerBody["stream"]).toBe(false);
			expect(providerBody["instructions"]).toBe("Preserve the original Responses history.");
			// 官方端点要求工具循环里的当前轮回显推理：补一条结构占位；占位排在该段 assistant
			// 产出的最前面（先有文本消息时在其之前），其它条目顺序不变。
			expect(providerBody["input"]).toEqual([
				expect.objectContaining({ type: "message", role: "system" }),
				originalInput[0],
				{ type: "reasoning", content: [{ type: "reasoning_text", text: "(reasoning omitted)" }] },
				originalInput[1],
				originalInput[2],
				originalInput[3],
			]);
			expect((providerBody["tools"] as Array<Record<string, unknown>>).map((tool) => tool["name"])).toEqual([
				"client_tool",
				"litellm__vision_inspect",
			]);
		});

		test("streaming DeepSeek Responses injects private capabilities through a native streaming agent turn", async () => {
			jest.spyOn(dbConfigProvider, "getParam").mockImplementation(async (param) =>
				param === "builtin_capabilities"
					? {
							vision: {
								enabled: true,
								always_inject: true,
								handler_model: "vision-worker",
								fallback_models: [],
								max_iterations: 3,
								max_output_tokens: 1024,
							},
						}
					: {},
			);
			const upstreamResponse = {
				id: "resp_native_capability_stream",
				object: "response",
				created_at: 1_700_000_200,
				status: "completed",
				model: "deepseek-v4-flash",
				output: [
					{
						id: "msg_stream",
						type: "message",
						status: "completed",
						role: "assistant",
						content: [{ type: "output_text", text: "OK", annotations: [] }],
					},
				],
				usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
			};
			const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
				const streaming = JSON.parse(String(init?.body ?? "{}")).stream === true;
				if (!streaming) {
					return new Response(JSON.stringify(upstreamResponse), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				return new Response(
					nativeResponsesSse({ id: "resp_cap_stream", text: "OK", model: "deepseek-v4.1-flash", usage: upstreamResponse.usage }),
					{ status: 200, headers: { "content-type": "text/event-stream" } },
				);
			});
			const nativeDeployment = deepseekDeployment();
			nativeDeployment.model_info = {
				...nativeDeployment.model_info,
				supports_function_calling: true,
				enabled_builtin_capabilities: ["vision"],
			};
			const app = buildApp(buildDeploymentRouter([nativeDeployment]));

			const response = await request(app)
				.post("/v1/responses")
				.send({ model: "deepseek-v4-flash", input: "Return OK.", store: false, stream: true })
				.expect(200);

			expect(fetchSpy).toHaveBeenCalledTimes(1);
			expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/responses");
			const providerBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
			expect(providerBody["stream"]).toBe(true);
			expect(providerBody["input"]).toBeDefined();
			expect(providerBody["tools"]).toEqual(
				expect.arrayContaining([expect.objectContaining({ type: "function", name: "litellm__vision_inspect" })]),
			);
			const events = parseSseEvents(response.text);
			expect(events.at(-1)).toMatchObject({
				type: "response.completed",
				response: { status: "completed" },
			});
		});



		test("streaming builtin capability keeps upstream details in the spend log", async () => {
			jest.spyOn(dbConfigProvider, "getParam").mockImplementation(async (param) =>
				param === "builtin_capabilities"
					? {
							vision: {
								enabled: true,
								always_inject: true,
								handler_model: "vision-worker",
								fallback_models: [],
								max_iterations: 3,
								max_output_tokens: 1024,
							},
						}
					: param === "general_settings"
						? { store_upstream_logs_in_spend_logs: true }
						: {},
			);
			jest.spyOn(SpendTracker, "reserveSpend").mockResolvedValue({
				status: "reserved",
				requestId: "request-capability-stream",
				reserved: 1,
				actual: null,
			});
			const trackSpy = jest
				.spyOn(SpendTracker, "trackSpendLog")
				.mockResolvedValue({ status: "committed", requestId: "request-capability-stream", spend: 0 });
			jest.spyOn(global, "fetch").mockImplementation(async () => {
				return new Response(
					nativeResponsesSse({
						id: "resp_cap_log",
						text: "OK",
						model: "deepseek-v4.1-flash",
						usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
					}),
					{ status: 200, headers: { "content-type": "text/event-stream" } },
				);
			});
			const nativeDeployment = deepseekDeployment();
			nativeDeployment.model_info = {
				...nativeDeployment.model_info,
				supports_function_calling: true,
				enabled_builtin_capabilities: ["vision"],
			};
			// SpendLog 只在已认证请求上写入，与生产一致。
			const app = buildApp(buildDeploymentRouter([nativeDeployment]), true);

			await request(app)
				.post("/v1/responses")
				.send({ model: "deepseek-v4-flash", input: "Return OK.", store: false, stream: true })
				.expect(200);

			expect(trackSpy).toHaveBeenCalledTimes(1);
			const logged = trackSpy.mock.calls[0]?.[1] as unknown as Record<string, Record<string, unknown>>;
			// 修复前：能力分支把能力链结果重建为新对象，挂在对象上的 Symbol 丢失，这里为空。
			expect(logged["proxy_server_request"]?.["upstream_request"]).toMatchObject({
				url: "https://api.deepseek.com/responses",
				method: "POST",
			});
			expect(logged["proxy_server_request"]?.["upstream_response"]).toMatchObject({ status_code: 200 });
		});

		test("DeepSeek native Responses executes private capability calls and continues with function output", async () => {
			jest.spyOn(dbConfigProvider, "getParam").mockImplementation(async (param) =>
				param === "builtin_capabilities"
					? {
							vision: {
								enabled: true,
								always_inject: true,
								handler_model: "vision-worker",
								fallback_models: [],
								max_iterations: 3,
								max_output_tokens: 1024,
							},
						}
					: {},
			);
			const unavailableRef = `sha256:${"a".repeat(64)}`;
			const fetchSpy = jest
				.spyOn(global, "fetch")
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({
							id: "resp_native_private_call",
							object: "response",
							created_at: 1_700_000_300,
							status: "completed",
							model: "deepseek-v4-flash",
							output: [
								{
									id: "fc_private",
									type: "function_call",
									status: "completed",
									call_id: "call_private",
									name: "litellm__vision_inspect",
									arguments: JSON.stringify({ image_refs: [unavailableRef], question: "What is shown?" }),
								},
							],
							usage: {
					input_tokens: 8,
					output_tokens: 4,
					total_tokens: 12,
					input_tokens_details: { cached_tokens: 6 },
					output_tokens_details: { reasoning_tokens: 2 },
				},
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					),
				)
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({
							id: "resp_native_private_done",
							object: "response",
							created_at: 1_700_000_301,
							status: "completed",
							model: "deepseek-v4-flash",
							output: [
								{
									id: "msg_private_done",
									type: "message",
									status: "completed",
									role: "assistant",
									content: [{ type: "output_text", text: "No image is available.", annotations: [] }],
								},
							],
							usage: {
					input_tokens: 12,
					output_tokens: 5,
					total_tokens: 17,
					input_tokens_details: { cached_tokens: 10 },
					output_tokens_details: { reasoning_tokens: 3 },
				},
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					),
				);
			const nativeDeployment = deepseekDeployment();
			nativeDeployment.model_info = {
				...nativeDeployment.model_info,
				supports_function_calling: true,
				enabled_builtin_capabilities: ["vision"],
			};
			const app = buildApp(buildDeploymentRouter([nativeDeployment]), false, null);

			const response = await request(app)
				.post("/v1/responses")
				.send({ model: "deepseek-v4-flash", input: "Inspect the unavailable image.", store: false })
				.expect(200);
			expect(response.body.usage).toMatchObject({
				input_tokens: 20,
				output_tokens: 9,
				total_tokens: 29,
				input_tokens_details: { cached_tokens: 16 },
				output_tokens_details: { reasoning_tokens: 5 },
			});
			expect(fetchSpy).toHaveBeenCalledTimes(2);
			const continuationBody = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;
			expect(continuationBody["input"]).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ type: "function_call", call_id: "call_private" }),
					expect.objectContaining({ type: "function_call_output", call_id: "call_private" }),
				]),
			);
			expect(response.body.output).toEqual([
				expect.objectContaining({
					type: "message",
					content: [expect.objectContaining({ type: "output_text", text: "No image is available." })],
				}),
			]);
		});



	test("非流式响应不会为纯空白的 reasoning 生成 output item", async () => {
		// 生产实测：上游有时只产出 1 个 reasoning token（一个空格），不该变成空的思考区。
		const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "chatcmpl-blank-reasoning",
					object: "chat.completion",
					created: 1_700_000_900,
					model: "provider-model",
					choices: [
						{
							index: 0,
							finish_reason: "tool_calls",
							message: {
								role: "assistant",
								content: null,
								reasoning_content: " ",
								tool_calls: [
									{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"SF"}' } },
								],
							},
						},
					],
					usage: {
						prompt_tokens: 5,
						completion_tokens: 3,
						total_tokens: 8,
						completion_tokens_details: { reasoning_tokens: 1 },
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		const app = buildApp(buildDeploymentRouter([deployment("chat-deployment", "https://example.com/v1")]));

		const response = await request(app)
			.post("/v1/responses")
			.send({ model: "chat-deployment", input: "weather?", store: false })
			.expect(200);

		expect(fetchSpy).toHaveBeenCalled();
		expect(response.body.output.some((item: { type: string }) => item.type === "reasoning")).toBe(false);
		expect(response.body.output.some((item: { type: string }) => item.type === "function_call")).toBe(true);
	});

		test("DeepSeek native failure falls back to a Chat deployment inside Router", async () => {
			const fetchSpy = jest
				.spyOn(global, "fetch")
				.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "deepseek failed" } }), { status: 500 }))
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({
							id: "chatcmpl-fallback",
							model: "provider-model",
							choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "fallback ok" } }],
							usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					),
				);
			const router = buildDeploymentRouter(
				[deepseekDeployment("deepseek-primary"), deployment("chat-fallback", "https://fallback.example/v1")],
				[{ "deepseek-primary": ["chat-fallback"] }],
			);
			const app = buildApp(router);

			const response = await request(app).post("/v1/responses").send({ model: "deepseek-primary", input: "hello" }).expect(200);

			expect(fetchSpy.mock.calls.map((call) => call[0])).toEqual([
				"https://api.deepseek.com/responses",
				"https://fallback.example/v1/chat/completions",
			]);
			const fallbackBody = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;
			expect(fallbackBody["messages"]).toEqual([{ role: "user", content: "hello" }]);
			expect(response.body.output[0]).toMatchObject({
				type: "message",
				content: [{ type: "output_text", text: "fallback ok" }],
			});
		});

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
				cost: 0.012,
				input_tokens: 9,
				input_tokens_details: { cached_tokens: 3 },
				output_tokens: 5,
				output_tokens_details: { reasoning_tokens: 2 },
				total_tokens: 14,
			});
		});

		test("Chat fallback accepts replayed Responses reasoning history without exposing it as a message", async () => {
			const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
				new Response(
					JSON.stringify({
						id: "chatcmpl-reasoning-history",
						object: "chat.completion",
						created: 1_700_000_002,
						model: "provider-model",
						choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "continued" } }],
						usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);
			const app = buildApp(buildDeploymentRouter([deployment("responses-model", "https://primary.example/v1")]));

			const response = await request(app)
				.post("/v1/responses")
				.send({
					model: "responses-model",
					input: [
						{
							id: "rs_previous",
							type: "reasoning",
							summary: [],
							encrypted_content: "encrypted-history",
						},
						{
							id: "msg_previous",
							type: "message",
							role: "assistant",
							content: [{ type: "output_text", text: "Earlier answer." }],
						},
						{ type: "message", role: "user", content: [{ type: "input_text", text: "Continue." }] },
					],
					store: false,
				})
				.expect(200);

			const providerBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
			expect(providerBody["messages"]).toEqual([
				{ role: "assistant", content: "Earlier answer." },
				{ role: "user", content: "Continue." },
			]);
			expect(response.body).toMatchObject({
				status: "completed",
				output: [
					{
						type: "message",
						content: [{ type: "output_text", text: "continued" }],
					},
				],
			});
		});

		test("Responses namespace tools are flattened for Chat providers and restored in function_call output", async () => {
			const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
				new Response(
					JSON.stringify({
						id: "chatcmpl-namespace",
						object: "chat.completion",
						created: 1_700_000_002,
						model: "provider-model",
						choices: [
							{
								index: 0,
								finish_reason: "tool_calls",
								message: {
									role: "assistant",
									content: null,
									tool_calls: [
										{
											id: "call_new",
											type: "function",
											function: { name: "mcp__node_repl__js", arguments: '{"code":"1+1"}' },
										},
									],
								},
							},
						],
						usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);
			const app = buildApp(buildDeploymentRouter([deployment("responses-model", "https://namespace.example/v1")]));

			const response = await request(app)
				.post("/v1/responses")
				.send({
					model: "responses-model",
					input: [
						{ type: "message", role: "user", content: "calculate" },
						{
							type: "function_call",
							call_id: "call_old",
							namespace: "mcp__node_repl",
							name: "js",
							arguments: '{"code":"40+2"}',
						},
						{ type: "function_call_output", call_id: "call_old", output: "42" },
					],
					tools: [
						{ type: "function", name: "plain_tool", parameters: { type: "object" } },
						{
							type: "namespace",
							name: "mcp__node_repl",
							description: "Run JavaScript",
							tools: [
								{
									type: "function",
									name: "js",
									description: "Evaluate code",
									parameters: { type: "object", properties: { code: { type: "string" } } },
								},
							],
						},
						{ type: "web_search", external_web_access: true },
					],
					tool_choice: { type: "function", namespace: "mcp__node_repl", name: "js" },
				})
				.expect(200);

			const providerBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
			expect(providerBody["tools"]).toEqual([
				{ type: "function", function: { name: "plain_tool", parameters: { type: "object" } } },
				{
					type: "function",
					function: {
						name: "mcp__node_repl__js",
						description: "Run JavaScript\n\nEvaluate code",
						parameters: { type: "object", properties: { code: { type: "string" } } },
					},
				},
			]);
			expect(providerBody["tool_choice"]).toEqual({ type: "function", function: { name: "mcp__node_repl__js" } });
			expect(providerBody["messages"]).toEqual([
				{ role: "user", content: "calculate" },
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call_old",
							type: "function",
							function: { name: "mcp__node_repl__js", arguments: '{"code":"40+2"}' },
						},
					],
				},
				{ role: "tool", tool_call_id: "call_old", content: "42" },
			]);
			expect(response.body.output).toEqual([
				expect.objectContaining({
					type: "function_call",
					call_id: "call_new",
					namespace: "mcp__node_repl",
					name: "js",
					arguments: '{"code":"1+1"}',
				}),
			]);
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

		test("stream function_call restores namespace after Chat tool name flattening", async () => {
			const upstream = [
				'data: {"id":"chatcmpl-ns-live","object":"chat.completion.chunk","created":1,"model":"provider-model","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_ns","type":"function","function":{"name":"codex_app__read_thread_terminal","arguments":"{}"}}]},"finish_reason":null}]}\n',
				'data: {"id":"chatcmpl-ns-live","object":"chat.completion.chunk","created":1,"model":"provider-model","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n',
				"data: [DONE]\n",
			];
			const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
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
				.send({
					model: "responses-model",
					input: "read terminal",
					stream: true,
					tools: [
						{
							type: "namespace",
							name: "codex_app",
							tools: [{ type: "function", name: "read_thread_terminal", parameters: { type: "object" } }],
						},
						{ type: "web_search", external_web_access: true },
					],
				})
				.expect(200);

			const providerBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
			expect(providerBody["tools"]).toEqual([
				{
					type: "function",
					function: { name: "codex_app__read_thread_terminal", parameters: { type: "object" } },
				},
			]);
			const events = parseSseEvents(response.text);
			const itemDone = events.find((event) => event["type"] === "response.output_item.done");
			expect(itemDone?.["item"]).toMatchObject({
				type: "function_call",
				call_id: "call_ns",
				namespace: "codex_app",
				name: "read_thread_terminal",
				arguments: "{}",
			});
			const completed = events.find((event) => event["type"] === "response.completed");
			expect((completed?.["response"] as Record<string, unknown>)?.["output"]).toEqual([
				expect.objectContaining({ namespace: "codex_app", name: "read_thread_terminal" }),
			]);
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
			completed_at: expect.any(Number),
			error: null,
			max_output_tokens: 128,
			model: "provider-fallback-model",
			reasoning: { effort: "medium" },
			temperature: 1,
			top_p: 1,
			user: null,
			metadata: {},
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

	test("不把 Responses input_image.file_id 伪装成 Chat image URL", async () => {
		const completion = jest.fn();
		const app = buildApp(buildRouter(completion));

		const response = await request(app)
			.post("/v1/responses")
			.send({
				model: "responses-model",
				input: [{ type: "message", role: "user", content: [{ type: "input_image", file_id: "file_123" }] }],
			})
			.expect(400);

		expect(response.body.error).toMatchObject({
			type: "invalid_request_error",
			message: expect.stringContaining("input_image.file_id"),
		});
		expect(completion).not.toHaveBeenCalled();
	});

	test.each([
		[{ store: true }, "store=false"],
		[{ background: true }, "background"],
		[{ previous_response_id: "resp_old" }, "previous_response_id"],
		[{ conversation: "conv_1" }, "conversation"],
	])("对未实现的持久化语义返回明确 501: %j", async (options, expectedMessage) => {
		const completion = jest.fn();
		const app = buildApp(buildRouter(completion));

		const response = await request(app)
			.post("/v1/responses")
			.send({ model: "responses-model", input: "hello", ...options })
			.expect(501);

		expect(response.body.error).toMatchObject({
			type: "not_implemented",
			message: expect.stringContaining(expectedMessage),
		});
		expect(completion).not.toHaveBeenCalled();
	});

	test("非流式 Chat refusal 映射为 Responses refusal content part", async () => {
		const completion = jest.fn().mockResolvedValue({
			id: "chatcmpl-refusal",
			object: "chat.completion",
			created: 123,
			model: "provider-model",
			choices: [
				{
					index: 0,
					finish_reason: "stop",
					message: { role: "assistant", content: null, refusal: "I cannot help with that." },
				},
			],
			usage: { prompt_tokens: 2, completion_tokens: 5, total_tokens: 7 },
		});
		const app = buildApp(buildRouter(completion));

		const response = await request(app).post("/v1/responses").send({ model: "responses-model", input: "hello" }).expect(200);

		expect(response.body.output).toEqual([
			expect.objectContaining({
				type: "message",
				content: [{ type: "refusal", refusal: "I cannot help with that." }],
			}),
		]);
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
		expect((events[0]?.response as Record<string, unknown>).completed_at).toBeNull();
		expect((events[0]?.response as Record<string, unknown>).max_output_tokens).toBeNull();
		expect((events[0]?.response as Record<string, unknown>).metadata).toEqual({});
		expect(eventTypes).toContain("response.reasoning_text.delta");
		expect(eventTypes).toContain("response.output_text.delta");
		expect(eventTypes).toContain("response.function_call_arguments.delta");
		expect(events.find((event) => event.type === "response.function_call_arguments.done")).toMatchObject({
			name: "weather",
			arguments: '{"city":"Paris"}',
		});
		expect(eventTypes.at(-1)).toBe("response.completed");
		expect((events.at(-1)?.response as Record<string, unknown>).completed_at).toEqual(expect.any(Number));
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

	test("stream finish_reason=length emits response.incomplete with max_output_tokens reason", async () => {
		async function* stream() {
			yield {
				id: "chatcmpl-incomplete",
				model: "provider-model",
				choices: [{ index: 0, delta: { role: "assistant", content: "partial" }, finish_reason: "length" }],
				usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
			};
		}
		const completion = jest.fn().mockResolvedValue({ _stream: true, stream: stream() });
		const app = buildApp(buildRouter(completion));

		const response = await request(app)
			.post("/v1/responses")
			.send({ model: "responses-model", input: "hello", stream: true, max_output_tokens: 3 })
			.expect(200);
		const events = parseSseEvents(response.text);
		const terminal = events.at(-1);
		expect(terminal).toMatchObject({
			type: "response.incomplete",
			response: {
				status: "incomplete",
				completed_at: null,
				incomplete_details: { reason: "max_output_tokens" },
				max_output_tokens: 3,
			},
		});
		expect(
			events.filter(
				(event) =>
					typeof event.type === "string" && ["response.completed", "response.incomplete", "response.failed"].includes(event.type),
			),
		).toHaveLength(1);
	});

	test("stream refusal emits discriminator-complete refusal delta/done events", async () => {
		async function* stream() {
			yield {
				id: "chatcmpl-refusal",
				model: "provider-model",
				choices: [{ index: 0, delta: { role: "assistant", refusal: "Cannot" }, finish_reason: null }],
			};
			yield {
				id: "chatcmpl-refusal",
				model: "provider-model",
				choices: [{ index: 0, delta: { refusal: " comply" }, finish_reason: "stop" }],
			};
		}
		const completion = jest.fn().mockResolvedValue({ _stream: true, stream: stream() });
		const app = buildApp(buildRouter(completion));

		const response = await request(app)
			.post("/v1/responses")
			.send({ model: "responses-model", input: "hello", stream: true })
			.expect(200);
		const events = parseSseEvents(response.text);

		expect(events.filter((event) => event.type === "response.refusal.delta").map((event) => event.delta)).toEqual([
			"Cannot",
			" comply",
		]);
		expect(events.find((event) => event.type === "response.refusal.done")).toMatchObject({
			content_index: 0,
			refusal: "Cannot comply",
		});
		expect((events.at(-1)?.response as { output: unknown[] }).output).toEqual([
			expect.objectContaining({ content: [{ type: "refusal", refusal: "Cannot comply" }] }),
		]);
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

	test("capability stream failure without an available fallback ends with one Responses terminal event", async () => {
		jest.spyOn(dbConfigProvider, "getParam").mockImplementation(async (param) =>
			param === "builtin_capabilities"
				? {
						vision: {
							enabled: true,
							always_inject: true,
							handler_model: "vision-worker",
							fallback_models: [],
							max_iterations: 3,
							max_output_tokens: 1024,
						},
					}
				: {},
		);
		jest.spyOn(SpendTracker, "reserveSpend").mockResolvedValue({
			status: "reserved",
			requestId: "request-capability-stream-failure",
			reserved: 1,
			actual: null,
		});
		const trackSpy = jest
			.spyOn(SpendTracker, "trackSpendLog")
			.mockResolvedValue({ status: "committed", requestId: "request-capability-stream-failure", spend: 0 });
		jest.spyOn(global, "fetch").mockImplementation(async () => {
			const envelope =
				"data: " +
				JSON.stringify({
					id: "chatcmpl-envelope",
					object: "chat.completion.chunk",
					created: 1700000400,
					model: "provider-model",
					choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
				}) +
				"\n\n";
			const body = new ReadableStream({
				start: (controller) => {
					controller.enqueue(new TextEncoder().encode(envelope));
					setTimeout(() => controller.error(new TypeError("terminated")), 0);
				},
			});
			return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
		});
		const capabilityDeployment = deployment("responses-model", "https://stream.example/v1");
		capabilityDeployment.model_info = {
			...capabilityDeployment.model_info,
			supports_function_calling: true,
			enabled_builtin_capabilities: ["vision"],
		};
		const app = buildApp(buildDeploymentRouter([capabilityDeployment]), true);

		const response = await request(app)
			.post("/v1/responses")
			.send({ model: "responses-model", input: "Return OK.", store: false, stream: true })
			.expect(200);
		const events = parseSseEvents(response.text);
		expect(events.filter((event) => event.type === "response.completed" || event.type === "response.failed")).toHaveLength(1);
		expect(events.at(-1)).toMatchObject({ type: "response.failed" });
		expect(response.text).not.toContain("stream_error");
		expect(trackSpy).toHaveBeenCalledTimes(1);
		expect(trackSpy.mock.calls[0]?.[1]).toMatchObject({ status: "failure" });
	});

	test("stream continues on the fallback deployment when the primary breaks after reasoning output", async () => {
		jest.spyOn(global, "fetch").mockImplementation(async (url) => {
			const primary = String(url).includes("primary.example");
			const sse = (payload: Record<string, unknown>) => "data: " + JSON.stringify(payload) + "\n\n";
			if (!primary) {
				return new Response(
					sse({
						id: "chatcmpl-fallback",
						object: "chat.completion.chunk",
						created: 1700000500,
						model: "fallback-provider-model",
						choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
					}) + "data: [DONE]\n\n",
					{ status: 200, headers: { "content-type": "text/event-stream" } },
				);
			}
			const reasoning =
				"data: " +
				JSON.stringify({
					id: "chatcmpl-primary",
					object: "chat.completion.chunk",
					created: 1700000500,
					model: "primary-provider-model",
					choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "thinking" }, finish_reason: null }],
				}) +
				"\n\n";
			const body = new ReadableStream({
				start: (controller) => {
					controller.enqueue(new TextEncoder().encode(reasoning));
					setTimeout(() => controller.error(new TypeError("terminated")), 0);
				},
			});
			return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
		});
		const app = buildApp(
			buildDeploymentRouter(
				[deployment("primary-model", "https://primary.example/v1"), deployment("fallback-model", "https://fallback.example/v1")],
				[{ "primary-model": ["fallback-model"] }],
			),
		);

		const response = await request(app)
			.post("/v1/responses")
			.send({ model: "primary-model", input: "hello", stream: true })
			.expect(200);
		const events = parseSseEvents(response.text);
		expect(events.filter((event) => event.type === "response.completed" || event.type === "response.failed")).toHaveLength(1);
		expect(events.at(-1)).toMatchObject({ type: "response.completed" });
		const completed = events.at(-1)?.["response"] as Record<string, unknown>;
		const output = completed["output"] as Array<Record<string, unknown>>;
		expect(output.some((item) => item["type"] === "message")).toBe(true);
		expect(JSON.stringify(output)).toContain("ok");
	});

	test("native upstream AbortError stays a failure even when its message resembles a client cancellation", async () => {
		jest.spyOn(SpendTracker, "reserveSpend").mockResolvedValue({
			status: "reserved",
			requestId: "request-1",
			reserved: 1,
			actual: null,
		});
		const trackSpy = jest.spyOn(SpendTracker, "trackSpendLog").mockResolvedValue({
			status: "committed",
			requestId: "request-1",
			spend: 0,
		});
		async function* failedStream() {
			yield { type: "response.created", response: { id: "resp-failed", status: "in_progress", output: [] } };
			throw Object.assign(new Error("client aborted"), { name: "AbortError" });
		}
		const completion = jest.fn().mockResolvedValue({ _stream: true, _responseProtocol: "responses", stream: failedStream() });
		const response = await request(buildApp(buildRouter(completion), true))
			.post("/v1/responses")
			.send({ model: "responses-model", input: "hello", stream: true })
			.expect(200);
		expect(parseSseEvents(response.text).at(-1)?.type).toBe("response.failed");
		expect(trackSpy).toHaveBeenCalledTimes(1);
		expect(trackSpy.mock.calls[0]?.[1]).toMatchObject({
			status: "failure",
			metadata: { status: "failure", termination_reason: "request_failed" },
		});
	});

	test.each(["chat", "native"] as const)("client abort interrupts a pending %s stream and records one aborted log", async (protocol) => {
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
			if (protocol === "native") {
				yield { type: "response.created", response: { id: "resp-abort", status: "in_progress", output: [] } };
				yield { type: "response.output_text.delta", item_id: "msg-abort", output_index: 0, content_index: 0, delta: "first" };
			} else {
			yield {
				id: "chatcmpl-abort",
				model: "provider-model",
				choices: [{ index: 0, delta: { content: "first" }, finish_reason: null }],
					usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
			};
			}
			await new Promise<never>(() => undefined);
		}
		const app = buildApp(
			buildRouter(
				jest.fn().mockResolvedValue({
					_stream: true,
					_responseProtocol: protocol === "native" ? "responses" : "chat",
					stream: pendingStream(),
				}),
			),
			true,
		);
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
						let received = "";
						response.on("data", (chunk: Buffer) => {
							received += chunk.toString();
							if (received.includes("first")) {
							response.destroy();
							resolve();
							}
						});
					},
				);
				client.once("error", reject);
				client.end(JSON.stringify({ model: "responses-model", input: "hello", stream: true }));
			});
			await accounted;
			expect(trackSpy).toHaveBeenCalledTimes(1);
			expect(trackSpy.mock.calls[0]?.[1]).toMatchObject({
				status: "aborted",
				metadata: {
					status: "aborted",
					error_information: { error_type: "AbortError", error_message: "client aborted" },
				},
			});
			if (protocol === "chat") {
				expect(trackSpy.mock.calls[0]?.[1]).toMatchObject({ prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 });
			}
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

	test("streaming records the first-token time instead of falling back to endTime", async () => {
		jest.spyOn(SpendTracker, "reserveSpend").mockResolvedValue({
			status: "reserved",
			requestId: "request-ttft",
			reserved: 1,
			actual: null,
		});
		const trackSpy = jest
			.spyOn(SpendTracker, "trackSpendLog")
			.mockResolvedValue({ status: "committed", requestId: "request-ttft", spend: 0 });
		async function* streamingWithGap() {
			yield {
				id: "chatcmpl-ttft",
				model: "provider-model",
				choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }],
			};
			// 首个 chunk 到终止 chunk 之间留出可观测间隔，TTFT 必须小于总耗时。
			await new Promise((resolve) => setTimeout(resolve, 25));
			yield {
				id: "chatcmpl-ttft",
				model: "provider-model",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			};
		}
		const app = buildApp(buildRouter(jest.fn().mockResolvedValue({ _stream: true, stream: streamingWithGap() })), true);
		await request(app).post("/v1/responses").send({ model: "responses-model", input: "hello", stream: true }).expect(200);
		const spendLog = trackSpy.mock.calls[0]?.[1] as unknown as {
			startTime: string;
			endTime: string;
			completionStartTime: string;
		};
		const ttftMs = new Date(spendLog.completionStartTime).getTime() - new Date(spendLog.startTime).getTime();
		const totalMs = new Date(spendLog.endTime).getTime() - new Date(spendLog.startTime).getTime();
		expect(spendLog.completionStartTime).not.toBe(spendLog.endTime);
		expect(ttftMs).toBeGreaterThanOrEqual(0);
		expect(ttftMs).toBeLessThan(totalMs);
	});
	test.each(["/v1/responses", "/v1/chat/completions"])(
		"streams the successful image caption exactly once after a live reasoning delta on %s",
		async (endpoint) => {
			jest.spyOn(dbConfigProvider, "getParam").mockImplementation(async (param) =>
				param === "builtin_capabilities"
					? {
							image_generation: { enabled: true, always_inject: true, handler_model: "worker", max_iterations: 3 },
						}
					: {},
			);
			const caption = "A green leaf on white.";
			async function* decision() {
				const head = { id: "image-decision", object: "chat.completion.chunk", model: "responses-model", created: 1 };
				yield {
					...head,
					choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "Preparing." }, finish_reason: null }],
				};
				yield {
					...head,
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{
										index: 0,
										id: "image",
										type: "function",
										function: {
											name: "litellm__image_create",
											arguments: JSON.stringify({
												prompt: "green leaf",
												output_count: 1,
												output_index: 1,
												final_response: "image_and_caption",
												final_caption: caption,
											}),
										},
									},
								],
							},
							finish_reason: "tool_calls",
						},
					],
					usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
				};
			}
			const completion = jest.fn().mockImplementation(async () => ({ _stream: true, stream: decision() }));
			const router = buildRouter(completion);
			router.getDeployments = () => [
				{
					model_name: "responses-model",
					litellm_params: { model: "openai/provider-model" },
					model_info: { supports_function_calling: true, enabled_builtin_capabilities: ["image_generation"] },
				},
			];
			router.resolveModelGroupWithTrace = (m: string) => ({ inputModel: m, resolvedModel: m, resolutionPath: [m] });
			router.imageGeneration = jest.fn().mockResolvedValue({ data: [{ b64_json: "AA==" }] });
			const app = buildApp(router, false, null);
			const routes = express.Router();
			registerChatCompletionsRoutes(routes, router, undefined as never);
			app.use(routes);
			const message = { role: "user", content: "Draw a green leaf and provide a short caption." };
			const responsesApi = endpoint === "/v1/responses";
			const result = await request(app)
				.post(endpoint)
				.send({ model: "responses-model", stream: true, ...(responsesApi ? { input: [message] } : { messages: [message] }) })
				.expect(200);
			const chunks = result.text
				.split("\n")
				.filter((l) => l.startsWith("data: {"))
				.map((l) => JSON.parse(l.slice(6)));
			const texts = responsesApi
				? chunks.filter((c) => c.type === "response.output_text.delta").map((c) => c.delta)
				: chunks.flatMap((c) => (c.choices ?? []).map((x: { delta: { content?: string } }) => x.delta.content ?? ""));
			expect(texts.join("")).toBe(caption);
			expect(completion).toHaveBeenCalledTimes(1);
			expect(router.imageGeneration).toHaveBeenCalledTimes(1);
			expect(result.text).not.toContain("_builtinImageCaption");
			expect(result.text).not.toContain("litellm__image_create");
		},
	);

	test("built-in image creation streams an image_generation_call without failing the terminal event", async () => {
		jest.spyOn(dbConfigProvider, "getParam").mockImplementation(async (param) => param === "builtin_capabilities"
			? {
				image_generation: {
					enabled: true,
					always_inject: true,
					handler_model: "image-worker",
					fallback_models: [],
					max_iterations: 3,
				},
			}
			: {});
		const completion = jest
			.fn()
			.mockResolvedValueOnce({
			id: "chatcmpl-image-call-stream",
			created: 1,
			model: "responses-model",
			choices: [
				{
					index: 0,
					finish_reason: "tool_calls",
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call-image-create-stream",
								type: "function",
								function: {
									name: "litellm__image_create",
									arguments: '{"prompt":"A blue paper crane"}',
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		})
			.mockResolvedValueOnce({
			id: "chatcmpl-image-final-stream",
			created: 2,
			model: "responses-model",
			choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Created." } }],
			usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
		});
		const router = buildRouter(completion);
		router.getDeployments = () => [
			{
				model_name: "responses-model",
				litellm_params: { model: "openai/provider-model" },
				model_info: { supports_function_calling: true, enabled_builtin_capabilities: ["image_generation"] },
			},
		];
		router.resolveModelGroupWithTrace = (model) => ({ inputModel: model, resolvedModel: model, resolutionPath: [model] });
		router.imageGeneration = jest.fn().mockResolvedValue({
			created: 2,
			output_format: "png",
			data: [{ b64_json: "AA==" }],
			usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
		});
		const response = await request(buildApp(router, false, null))
			.post("/v1/responses")
			.send({ model: "responses-model", input: "Create a blue paper crane", store: false, stream: true })
			.expect(200);
		const events = parseSseEvents(response.text);
		const terminal = events.filter((event) => event.type === "response.completed" || event.type === "response.failed");
		expect(terminal).toHaveLength(1);
		expect(terminal[0]?.type).toBe("response.completed");
		expect(events.map((event) => event.type)).toContain("response.image_generation_call.completed");
		expect(
			events.filter(
				(event) =>
					event.type === "response.output_item.done" && (event.item as Record<string, unknown>)?.type === "image_generation_call",
			),
		).toHaveLength(1);
		const completed = terminal[0]?.response as Record<string, unknown>;
		expect(completed["output"]).toEqual(expect.arrayContaining([expect.objectContaining({ type: "image_generation_call", status: "completed", result: "AA==" })]));
		expect(JSON.stringify(events)).not.toContain("litellm__image_create");
	});
	test("built-in image creation is returned as an official image_generation_call item", async () => {
		jest.spyOn(dbConfigProvider, "getParam").mockImplementation(async (param) =>
			param === "builtin_capabilities"
				? {
						image_generation: {
							enabled: true,
							always_inject: true,
							handler_model: "image-worker",
							fallback_models: [],
							max_iterations: 3,
						},
					}
				: {},
		);
		const completion = jest
			.fn()
			.mockResolvedValueOnce({
				id: "chatcmpl-image-call",
				created: 1,
				model: "responses-model",
				choices: [
					{
						index: 0,
						finish_reason: "tool_calls",
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call-image-create",
									type: "function",
									function: {
										name: "litellm__image_create",
										arguments: '{"prompt":"A blue paper crane"}',
									},
								},
							],
						},
					},
				],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			})
			.mockResolvedValueOnce({
				id: "chatcmpl-image-final",
				created: 2,
				model: "responses-model",
				choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Created." } }],
				usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
			});
		const router = buildRouter(completion) as LiteLLMRouter & { imageGeneration: jest.Mock };
		router.getDeployments = () => [
			{
				model_name: "responses-model",
				litellm_params: { model: "openai/provider-model" },
				model_info: { supports_function_calling: true, enabled_builtin_capabilities: ["image_generation"] },
			},
		];
		router.resolveModelGroupWithTrace = (model: string) => ({ inputModel: model, resolvedModel: model, resolutionPath: [model] });
		router.imageGeneration = jest.fn().mockResolvedValue({
			created: 2,
			output_format: "png",
			data: [{ b64_json: "AA==" }],
			usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
		});

		const response = await request(buildApp(router, false, null))
			.post("/v1/responses")
			.send({ model: "responses-model", input: "Create a blue paper crane", store: false })
			.expect(200);

		expect(response.body.output).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: "image_generation_call", status: "completed", result: "AA==" })]),
		);
		expect(JSON.stringify(response.body)).not.toContain("litellm__image_create");
	});
	test("native Responses relay records the first semantic delta instead of falling back to endTime", async () => {
		jest.spyOn(SpendTracker, "reserveSpend").mockResolvedValue({
			status: "reserved",
			requestId: "request-native-ttft",
			reserved: 1,
			actual: null,
		});
		const trackSpy = jest
			.spyOn(SpendTracker, "trackSpendLog")
			.mockResolvedValue({ status: "committed", requestId: "request-native-ttft", spend: 0 });
		const terminalResponse = {
			id: "resp-native-ttft",
			object: "response",
			status: "completed",
			model: "provider-model",
			output: [],
			usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 },
		};
		async function* nativeResponsesWithGap() {
			// response.created 是包络事件，由本端立即转发，不能当作首字。
			yield { type: "response.created", response: { ...terminalResponse, status: "in_progress" } };
			await new Promise((resolve) => setTimeout(resolve, 25));
			yield { type: "response.output_text.delta", item_id: "item-1", output_index: 0, content_index: 0, delta: "hello" };
			await new Promise((resolve) => setTimeout(resolve, 25));
			yield { type: "response.completed", response: terminalResponse };
		}
		const app = buildApp(buildRouter(jest.fn().mockResolvedValue({ _stream: true, _responseProtocol: "responses", stream: nativeResponsesWithGap() })), true);
		await request(app).post("/v1/responses").send({ model: "responses-model", input: "hello", stream: true }).expect(200);
		const spendLog = trackSpy.mock.calls[0]?.[1] as unknown as {
			startTime: string;
			endTime: string;
			completionStartTime: string;
		};
		const ttftMs = new Date(spendLog.completionStartTime).getTime() - new Date(spendLog.startTime).getTime();
		const totalMs = new Date(spendLog.endTime).getTime() - new Date(spendLog.startTime).getTime();
		// 修复前 completionStartTime 会回落成 endTime，TTFT 就等于总耗时。
		expect(spendLog.completionStartTime).not.toBe(spendLog.endTime);
		expect(ttftMs).toBeGreaterThanOrEqual(0);
		expect(ttftMs).toBeLessThan(totalMs);
	});
});
