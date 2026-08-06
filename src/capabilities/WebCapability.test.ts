import { dbConfigProvider } from "../core/config/DbConfigProvider";
import type { Router } from "../router/Router";
import type { ModelListItem } from "../types/config";
import { executeWebToolCall } from "./WebCapabilityExecution";
import { PRIVATE_WEB_FETCH_TOOL_NAME, PRIVATE_WEB_SEARCH_TOOL_NAME } from "./WebCapabilityProtocol";
import { prepareAnthropicWebRequest, prepareOpenAIWebRequest, runAnthropicWebAgentLoop, runOpenAIWebAgentLoop } from "./WebCapability";
import { runAnthropicBuiltinCapabilityAgentLoop, runOpenAIBuiltinCapabilityAgentLoop } from "./BuiltinCapabilityRunner";
import { PRIVATE_VISION_TOOL_NAME } from "./VisionCapability";
import { MemoryVisionImageStore } from "./VisionImageStore";

const IMAGE_REF = "sha256:ce7c4f52106d5f03ccda1154a0af16baa95d222e354ca62e5f32e5e53e8180a7";

function targetDeployment(): ModelListItem {
	return {
		model_name: "text-model",
		litellm_params: { model: "deepseek/text-model" },
		model_info: {
			supports_function_calling: true,
			enabled_builtin_capabilities: ["web"],
		},
	};
}

function fakeRouter(): Router {
	return {
		getDeployments: () => [
			targetDeployment(),
			{
				model_name: "network-model",
				litellm_params: { model: "openai/network-model" },
				model_info: {},
			},
			{
				model_name: "network-fallback",
				litellm_params: { model: "anthropic/network-fallback" },
				model_info: {},
			},
		],
		resolveModelGroupWithTrace: (model: string) => ({
			inputModel: model,
			resolvedModel: model,
			resolutionPath: [model],
		}),
	} as unknown as Router;
}

function completion(message: Record<string, unknown>) {
	return {
		id: "chatcmpl_web",
		object: "chat.completion",
		created: 1,
		model: "test",
		choices: [{ index: 0, finish_reason: "stop", message: message }],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
	};
}

describe("WebCapability", () => {
	beforeEach(() => {
		jest.spyOn(dbConfigProvider, "getParam").mockResolvedValue({
			web: {
				enabled: true,
				handler_model: "network-model",
				fallback_models: ["network-fallback"],
				max_iterations: 3,
				max_output_tokens: 2048,
			},
		});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("injects private search and fetch tools only for selected models", async () => {
		const prepared = await prepareOpenAIWebRequest(fakeRouter(), "text-model", [{ role: "user", content: "latest news" }]);
		expect(prepared).toBeDefined();
		expect(JSON.stringify(prepared!.messages)).toContain(PRIVATE_WEB_SEARCH_TOOL_NAME);
		expect(JSON.stringify(prepared!.messages)).toContain(PRIVATE_WEB_FETCH_TOOL_NAME);

		const unselected = targetDeployment();
		unselected.model_info!.enabled_builtin_capabilities = [];
		const router = {
			...fakeRouter(),
			getDeployments: () => [unselected, ...fakeRouter().getDeployments().slice(1)],
		} as Router;
		await expect(prepareOpenAIWebRequest(router, "text-model", [])).resolves.toBeUndefined();
	});

	it("delegates a live search to the configured network model and hides the private turn", async () => {
		let targetCalls = 0;
		const complete = jest.fn(async (model: string, messages: any[], params: Record<string, unknown>) => {
			if (model === "network-model") {
				expect(params["web_search_options"]).toEqual({ search_context_size: "high" });
				expect(JSON.stringify(messages)).toContain("TypeScript 6 release date");
				return completion({
					role: "assistant",
					content: "TypeScript 6 was announced on 2026-08-01. Source: https://example.com/ts6",
				});
			}
			targetCalls++;
			if (targetCalls === 1) {
				const toolNames = (params["tools"] as Array<{ function: { name: string } }>).map((tool) => tool.function.name);
				expect(toolNames).toEqual([PRIVATE_WEB_SEARCH_TOOL_NAME, PRIVATE_WEB_FETCH_TOOL_NAME]);
				return completion({
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "search-1",
							type: "function",
							function: {
								name: PRIVATE_WEB_SEARCH_TOOL_NAME,
								arguments: JSON.stringify({ query: "TypeScript 6 release date", recency_days: 30 }),
							},
						},
					],
				});
			}
			expect(JSON.stringify(messages)).toContain("https://example.com/ts6");
			return completion({ role: "assistant", content: "TypeScript 6 was announced on August 1." });
		});

		const result = await runOpenAIWebAgentLoop(
			fakeRouter(),
			"text-model",
			[{ role: "user", content: "When was TypeScript 6 announced?" }],
			{},
			complete,
			{ workerComplete: complete },
		);

		expect(targetCalls).toBe(2);
		expect(JSON.stringify(result)).not.toContain(PRIVATE_WEB_SEARCH_TOOL_NAME);
		expect((result["choices"] as any[])[0].message.content).toContain("August 1");
	});

	it("uses the same configured worker to fetch a specific webpage", async () => {
		const complete = jest.fn(async (model: string, messages: any[], params: Record<string, unknown>) => {
			expect(model).toBe("network-model");
			expect(params["web_search_options"]).toBeDefined();
			expect(JSON.stringify(messages)).toContain("https://example.com/docs");
			expect(JSON.stringify(messages)).toContain("Extract the API limits");
			return completion({ role: "assistant", content: "Page title: Docs. API limit: 100 rpm." });
		});

		const result = await executeWebToolCall(
			fakeRouter(),
			{
				handlerModel: "network-model",
				fallbackModels: [],
				maxIterations: 3,
				maxOutputTokens: 1024,
			},
			PRIVATE_WEB_FETCH_TOOL_NAME,
			JSON.stringify({ url: "https://example.com/docs", instructions: "Extract the API limits" }),
			complete,
		);

		expect(result.text).toContain("100 rpm");
	});

	it("rejects unknown private tool names instead of treating them as fetch", async () => {
		const complete = jest.fn();
		await expect(
			executeWebToolCall(
				fakeRouter(),
				{
					handlerModel: "network-model",
					fallbackModels: [],
					maxIterations: 3,
					maxOutputTokens: 1024,
				},
				"litellm__web_unknown",
				JSON.stringify({ url: "https://example.com", instructions: "Read it" }),
				complete,
			),
		).rejects.toMatchObject({ statusCode: 400, message: "未知的网络工具: litellm__web_unknown" });
		expect(complete).not.toHaveBeenCalled();
	});

	it("lets OpenAI models re-decide client tools after a mixed private web turn", async () => {
		let mainTurn = 0;
		const complete = jest.fn(async (model: string, messages: any[]) => {
			if (model === "network-model") {
				return completion({ role: "assistant", content: "The current release is 6.0." });
			}
			mainTurn++;
			if (mainTurn === 1) {
				return completion({
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call_web",
							type: "function",
							function: {
								name: PRIVATE_WEB_SEARCH_TOOL_NAME,
								arguments: JSON.stringify({ query: "current release" }),
							},
						},
						{
							id: "call_read",
							type: "function",
							function: { name: "Read", arguments: '{"file_path":"package.json"}' },
						},
					],
				});
			}
			const hiddenAssistant = [...messages].reverse().find((message: Record<string, unknown>) => message["role"] === "assistant");
			expect((hiddenAssistant?.["tool_calls"] as Array<{ function: { name: string } }>).map((call) => call.function.name)).toEqual([
				PRIVATE_WEB_SEARCH_TOOL_NAME,
			]);
			expect(JSON.stringify(messages)).toContain("current release is 6.0");
			return completion({
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "call_read_after_web",
						type: "function",
						function: { name: "Read", arguments: '{"file_path":"package.json"}' },
					},
				],
			});
		});

		const result = await runOpenAIWebAgentLoop(
			fakeRouter(),
			"text-model",
			[{ role: "user", content: "Compare the current release with package.json" }],
			{
				tools: [
					{
						type: "function",
						function: { name: "Read", description: "Read a file", parameters: { type: "object" } },
					},
				],
			},
			complete,
			{ workerComplete: complete },
		);

		const finalMessage = (result["choices"] as Array<{ message: Record<string, unknown> }>)[0]!.message;
		expect((finalMessage["tool_calls"] as Array<{ id: string }>)[0]!.id).toBe("call_read_after_web");
		expect(JSON.stringify(result)).not.toContain(PRIVATE_WEB_SEARCH_TOOL_NAME);
		expect(mainTurn).toBe(2);
	});

	it("injects native Anthropic private tools without exposing provider web tools to the target model", async () => {
		const prepared = await prepareAnthropicWebRequest(fakeRouter(), "text-model", {
			model: "text-model",
			messages: [{ role: "user", content: "Read the latest docs" }],
		});

		expect(prepared).toBeDefined();
		expect(JSON.stringify(prepared!.body["tools"])).toContain(PRIVATE_WEB_SEARCH_TOOL_NAME);
		expect(JSON.stringify(prepared!.body["tools"])).toContain(PRIVATE_WEB_FETCH_TOOL_NAME);
		expect(JSON.stringify(prepared!.body["tools"])).not.toContain('"type":"web_search"');
	});

	it("lets Anthropic models re-decide client tools after a mixed private web turn", async () => {
		const prepared = await prepareAnthropicWebRequest(fakeRouter(), "text-model", {
			model: "text-model",
			tools: [{ name: "Agent", description: "Launch an agent", input_schema: { type: "object" } }],
			messages: [{ role: "user", content: "Research this before launching an agent" }],
		});
		expect(prepared).toBeDefined();
		let mainTurn = 0;
		const completeNative = jest.fn(async (body: Record<string, unknown>) => {
			mainTurn++;
			if (mainTurn === 1) {
				return {
					id: "msg_mixed_web",
					type: "message",
					role: "assistant",
					content: [
						{ type: "tool_use", id: "toolu_web", name: PRIVATE_WEB_SEARCH_TOOL_NAME, input: { query: "current release" } },
						{ type: "tool_use", id: "toolu_agent", name: "Agent", input: { prompt: "Inspect the repository" } },
					],
					stop_reason: "tool_use",
					usage: { input_tokens: 1, output_tokens: 1 },
				};
			}
			const messages = body["messages"] as Array<Record<string, unknown>>;
			const hiddenAssistant = [...messages].reverse().find((message) => message["role"] === "assistant");
			const hiddenToolNames = (hiddenAssistant?.["content"] as Array<Record<string, unknown>>)
				.filter((block) => block["type"] === "tool_use")
				.map((block) => block["name"]);
			expect(hiddenToolNames).toEqual([PRIVATE_WEB_SEARCH_TOOL_NAME]);
			expect(JSON.stringify(messages)).toContain("current release is 6.0");
			return {
				id: "msg_public_tool",
				type: "message",
				role: "assistant",
				content: [{ type: "tool_use", id: "toolu_agent_after_web", name: "Agent", input: { prompt: "Inspect the repository" } }],
				stop_reason: "tool_use",
				usage: { input_tokens: 2, output_tokens: 2 },
			};
		});
		const workerComplete = jest.fn(async () => completion({ role: "assistant", content: "The current release is 6.0." }));

		const result = await runAnthropicWebAgentLoop(fakeRouter(), prepared!, completeNative, undefined, workerComplete);

		expect(result.response["content"]).toEqual([
			expect.objectContaining({ type: "tool_use", name: "Agent", id: "toolu_agent_after_web" }),
		]);
		expect(JSON.stringify(result.response)).not.toContain(PRIVATE_WEB_SEARCH_TOOL_NAME);
		expect(mainTurn).toBe(2);
	});

	it("composes web and vision without either private tool leaking to the client", async () => {
		jest.mocked(dbConfigProvider.getParam).mockResolvedValue({
			vision: {
				enabled: true,
				handler_model: "vision-model",
				fallback_models: [],
				max_iterations: 3,
				max_output_tokens: 1024,
			},
			web: {
				enabled: true,
				handler_model: "network-model",
				fallback_models: [],
				max_iterations: 3,
				max_output_tokens: 2048,
			},
		});
		const both = targetDeployment();
		both.model_info!.enabled_builtin_capabilities = ["vision", "web"];
		const router = {
			...fakeRouter(),
			getDeployments: () => [
				both,
				...fakeRouter().getDeployments().slice(1),
				{
					model_name: "vision-model",
					litellm_params: { model: "openai/vision-model" },
					model_info: { supports_vision: true },
				},
			],
		} as Router;
		let targetCalls = 0;
		const complete = jest.fn(async (model: string, messages: any[], params: Record<string, unknown>) => {
			if (model === "vision-model") {
				return completion({ role: "assistant", content: "The screenshot says version 6." });
			}
			if (model === "network-model") {
				return completion({ role: "assistant", content: "Version 6 shipped today. https://example.com/release" });
			}
			targetCalls++;
			expect(JSON.stringify(params["tools"])).toContain(PRIVATE_WEB_SEARCH_TOOL_NAME);
			expect(JSON.stringify(params["tools"])).toContain(PRIVATE_VISION_TOOL_NAME);
			if (targetCalls === 1) {
				return completion({
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "vision-1",
							type: "function",
							function: {
								name: PRIVATE_VISION_TOOL_NAME,
								arguments: JSON.stringify({
									image_refs: ["sha256:ce7c4f52106d5f03ccda1154a0af16baa95d222e354ca62e5f32e5e53e8180a7"],
									question: "What version is visible?",
								}),
							},
						},
					],
				});
			}
			if (targetCalls === 2) {
				return completion({
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "web-1",
							type: "function",
							function: {
								name: PRIVATE_WEB_SEARCH_TOOL_NAME,
								arguments: JSON.stringify({ query: "version 6 release status" }),
							},
						},
					],
				});
			}
			return completion({ role: "assistant", content: "The screenshot and live release page both confirm version 6." });
		});

		const result = await runOpenAIBuiltinCapabilityAgentLoop(
			router,
			"text-model",
			[
				{
					role: "user",
					content: [
						{ type: "text", text: "Verify this against the web" },
						{ type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
					],
				},
			],
			{},
			complete,
			{ visionImageStore: new MemoryVisionImageStore() },
		);

		expect(targetCalls).toBe(3);
		expect(JSON.stringify(result)).not.toContain("litellm__");
		expect((result["choices"] as any[])[0].message.content).toContain("both confirm");
	});

	it("composes Anthropic web and vision while returning the original clean request body", async () => {
		jest.mocked(dbConfigProvider.getParam).mockResolvedValue({
			vision: {
				enabled: true,
				handler_model: "vision-model",
				fallback_models: [],
				max_iterations: 3,
				max_output_tokens: 1024,
			},
			web: {
				enabled: true,
				handler_model: "network-model",
				fallback_models: [],
				max_iterations: 3,
				max_output_tokens: 2048,
			},
		});
		const both = targetDeployment();
		both.model_info!.enabled_builtin_capabilities = ["vision", "web"];
		const router = {
			...fakeRouter(),
			getDeployments: () => [
				both,
				...fakeRouter().getDeployments().slice(1),
				{
					model_name: "vision-model",
					litellm_params: { model: "openai/vision-model" },
					model_info: { supports_vision: true },
				},
			],
			completion: jest.fn(async () => completion({ role: "assistant", content: "The image says version 6." })),
		} as unknown as Router;
		const originalBody = {
			model: "text-model",
			tools: [{ name: "Agent", description: "Launch an agent", input_schema: { type: "object" } }],
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "Verify this image against the web" },
						{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
					],
				},
			],
		};
		let mainTurn = 0;
		const completeNative = jest.fn(async () => {
			mainTurn++;
			if (mainTurn === 1) {
				return {
					id: "msg_vision",
					type: "message",
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_vision",
							name: PRIVATE_VISION_TOOL_NAME,
							input: { image_refs: [IMAGE_REF], question: "Which version is visible?" },
						},
					],
					stop_reason: "tool_use",
					usage: { input_tokens: 1, output_tokens: 1 },
				};
			}
			if (mainTurn === 2) {
				return {
					id: "msg_web",
					type: "message",
					role: "assistant",
					content: [
						{ type: "tool_use", id: "toolu_web", name: PRIVATE_WEB_SEARCH_TOOL_NAME, input: { query: "version 6 release" } },
					],
					stop_reason: "tool_use",
					usage: { input_tokens: 1, output_tokens: 1 },
				};
			}
			return {
				id: "msg_final",
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: "The image and web both confirm version 6." }],
				stop_reason: "end_turn",
				usage: { input_tokens: 1, output_tokens: 1 },
			};
		});
		const workerComplete = jest.fn(async () =>
			completion({ role: "assistant", content: "Version 6 shipped today. https://example.com/release" }),
		);

		const result = await runAnthropicBuiltinCapabilityAgentLoop(router, "text-model", originalBody, completeNative, {
			visionImageStore: new MemoryVisionImageStore(),
			workerComplete: workerComplete,
		});

		expect(result.response["content"]).toEqual([{ type: "text", text: "The image and web both confirm version 6." }]);
		expect(result.body).toBe(originalBody);
		expect(JSON.stringify(result.body)).not.toContain("litellm__");
		expect(mainTurn).toBe(3);
	});

	it("caps nested Anthropic capability loops with one shared main-model budget", async () => {
		jest.mocked(dbConfigProvider.getParam).mockResolvedValue({
			vision: {
				enabled: true,
				handler_model: "vision-model",
				fallback_models: [],
				max_iterations: 3,
				max_output_tokens: 1024,
			},
			web: {
				enabled: true,
				handler_model: "network-model",
				fallback_models: [],
				max_iterations: 3,
				max_output_tokens: 2048,
			},
		});
		const both = targetDeployment();
		both.model_info!.enabled_builtin_capabilities = ["vision", "web"];
		const router = {
			...fakeRouter(),
			getDeployments: () => [
				both,
				...fakeRouter().getDeployments().slice(1),
				{
					model_name: "vision-model",
					litellm_params: { model: "openai/vision-model" },
					model_info: { supports_vision: true },
				},
			],
			completion: jest.fn(async () => completion({ role: "assistant", content: "vision result" })),
		} as unknown as Router;
		let mainTurn = 0;
		const completeNative = jest.fn(async () => {
			mainTurn++;
			const cycle = (mainTurn - 1) % 3;
			if (cycle < 2) {
				return {
					id: `msg_vision_${mainTurn}`,
					type: "message",
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: `toolu_vision_${mainTurn}`,
							name: PRIVATE_VISION_TOOL_NAME,
							input: { image_refs: [IMAGE_REF], question: "Inspect again" },
						},
					],
					stop_reason: "tool_use",
					usage: { input_tokens: 1, output_tokens: 1 },
				};
			}
			return {
				id: `msg_web_${mainTurn}`,
				type: "message",
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: `toolu_web_${mainTurn}`,
						name: PRIVATE_WEB_SEARCH_TOOL_NAME,
						input: { query: "search again" },
					},
				],
				stop_reason: "tool_use",
				usage: { input_tokens: 1, output_tokens: 1 },
			};
		});
		const body = {
			model: "text-model",
			messages: [
				{
					role: "user",
					content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } }],
				},
			],
		};

		await expect(
			runAnthropicBuiltinCapabilityAgentLoop(router, "text-model", body, completeNative, {
				visionImageStore: new MemoryVisionImageStore(),
				workerComplete: jest.fn(async () => completion({ role: "assistant", content: "web result" })),
			}),
		).rejects.toMatchObject({ statusCode: 503, message: "组合内置能力处理超过 6 个主模型轮次仍未完成" });
		expect(mainTurn).toBe(6);
		expect(completeNative).toHaveBeenCalledTimes(6);
	});
});
