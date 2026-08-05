import type { Router } from "../router/Router";
import type { ModelListItem } from "../types/config";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import { stripInternalFields } from "../core/api/stripInternalFields";
import {
	PRIVATE_VISION_TOOL_NAME,
	executeVisionToolCall,
	prepareAnthropicVisionRequest,
	prepareOpenAIVisionRequest,
	runAnthropicVisionAgentLoop,
	runOpenAIVisionAgentLoop,
} from "./VisionCapability";
import type { VisionCapabilityModelCall } from "./VisionCapability";
import { MemoryVisionImageStore } from "./VisionImageStore";

const IMAGE_REF = "sha256:ce7c4f52106d5f03ccda1154a0af16baa95d222e354ca62e5f32e5e53e8180a7";

function deployment(): ModelListItem {
	return {
		model_name: "deepseek-v4-flash",
		litellm_params: { model: "deepseek/deepseek-v4-flash" },
		model_info: {
			supports_vision: false,
			supports_function_calling: true,
			enabled_builtin_capabilities: ["vision"],
		},
	};
}

function fakeRouter(): Router {
	return {
		getDeployments: () => [
			deployment(),
			{
				model_name: "gpt-5.4-mini",
				litellm_params: { model: "openai/gpt-5.4-mini" },
				model_info: { supports_vision: true },
			},
			{
				model_name: "gpt-5.4",
				litellm_params: { model: "openai/gpt-5.4" },
				model_info: { supports_vision: true },
			},
		],
		resolveModelGroupWithTrace: (model: string) => ({
			inputModel: model,
			resolvedModel: model,
			resolutionPath: [model],
		}),
	} as unknown as Router;
}

function completion(message: Record<string, unknown>, usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }) {
	return {
		id: "chatcmpl_test",
		object: "chat.completion",
		created: 1,
		model: "test",
		choices: [{ index: 0, finish_reason: "stop", message: message }],
		usage: usage,
	};
}

describe("VisionCapability", () => {
	beforeEach(() => {
		jest.spyOn(dbConfigProvider, "getParam").mockResolvedValue({
			vision: {
				enabled: true,
				handler_model: "gpt-5.4-mini",
				fallback_models: ["gpt-5.4"],
				max_iterations: 3,
				max_output_tokens: 1024,
			},
		});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("replaces OpenAI image bytes with stable private references", async () => {
		const prepared = await prepareOpenAIVisionRequest(fakeRouter(), "deepseek-v4-flash", [
			{
				role: "user",
				content: [
					{ type: "text", text: "What failed?" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
				],
			},
		]);

		expect(prepared).toBeDefined();
		expect(prepared!.images.get(IMAGE_REF)?.chatPart).toEqual({
			type: "image_url",
			image_url: { url: "data:image/png;base64,abc=" },
		});
		expect(JSON.stringify(prepared!.messages)).not.toContain("base64,abc");
		expect(JSON.stringify(prepared!.messages)).toContain(IMAGE_REF);
		await expect(prepared!.imageStore.get(IMAGE_REF)).resolves.toMatchObject({
			ref: IMAGE_REF,
			mediaType: "image/png",
			base64Data: "abc=",
		});
	});

	it("injects vision for images nested in Anthropic client tool results", async () => {
		const prepared = await prepareAnthropicVisionRequest(fakeRouter(), "deepseek-v4-flash", {
			model: "deepseek-v4-flash",
			messages: [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_read",
							name: "Read",
							input: { file_path: "/tmp/screenshot.png" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_read",
							cache_control: { type: "ephemeral" },
							content: [
								{
									type: "image",
									source: { type: "base64", media_type: "image/png", data: "abc" },
								},
							],
						},
					],
				},
			],
		});

		expect(prepared).toBeDefined();
		expect(prepared!.images.get(IMAGE_REF)?.chatPart).toEqual({
			type: "image_url",
			image_url: { url: "data:image/png;base64,abc=" },
		});
		expect(JSON.stringify(prepared!.body)).not.toContain('"data":"abc"');
		expect(prepared!.body["messages"]).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					role: "user",
					content: [
						expect.objectContaining({
							type: "tool_result",
							tool_use_id: "toolu_read",
							cache_control: { type: "ephemeral" },
							content: [{ type: "text", text: `[Private image reference: ${IMAGE_REF}]` }],
						}),
					],
				}),
			]),
		);
		expect(JSON.stringify(prepared!.body["tools"])).toContain(PRIVATE_VISION_TOOL_NAME);
	});

	it("lets the main model choose the visual question and hides the private turn", async () => {
		const calls: Array<{ model: string; messages: Array<Record<string, unknown>>; params: Record<string, unknown> }> = [];
		const audit = jest.fn(async (call: VisionCapabilityModelCall) => ({ requestId: `child-${call.model}` }));
		const complete = jest.fn(async (model: string, messages: any[], params: Record<string, unknown>) => {
			calls.push({ model: model, messages: messages as Array<Record<string, unknown>>, params: params });
			if (model === "gpt-5.4-mini") {
				throw new Error("primary vision worker unavailable");
			}
			if (model === "gpt-5.4") {
				expect(JSON.stringify(messages)).toContain("Which exact compiler error is visible?");
				expect(JSON.stringify(messages)).toContain("data:image/png;base64,abc=");
				return completion(
					{ role: "assistant", content: "The screenshot shows TS2322 on line 17." },
					{ prompt_tokens: 40, completion_tokens: 60, total_tokens: 100 },
				);
			}
			if (calls.filter((call) => call.model === "deepseek-v4-flash").length === 1) {
				expect(JSON.stringify(messages)).not.toContain("base64,abc");
				expect(JSON.stringify(params["tools"])).toContain(PRIVATE_VISION_TOOL_NAME);
				return completion({
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call_private",
							type: "function",
							function: {
								name: PRIVATE_VISION_TOOL_NAME,
								arguments: JSON.stringify({
									image_refs: [IMAGE_REF],
									question: "Which exact compiler error is visible?",
									detail: "high",
								}),
							},
						},
					],
				});
			}
			expect(JSON.stringify(messages)).toContain("TS2322 on line 17");
			return completion({ role: "assistant", content: "The failure is TS2322 at line 17." });
		});

		const result = await runOpenAIVisionAgentLoop(
			fakeRouter(),
			"deepseek-v4-flash",
			[
				{
					role: "user",
					content: [
						{ type: "text", text: "Diagnose this screenshot" },
						{ type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
					],
				},
			],
			{},
			complete,
			{ audit: audit },
		);

		expect(JSON.stringify(stripInternalFields(result))).not.toContain(PRIVATE_VISION_TOOL_NAME);
		expect((result["choices"] as Array<Record<string, unknown>>)[0]).toMatchObject({
			message: { content: "The failure is TS2322 at line 17." },
		});
		expect(result["usage"]).toEqual({ prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 });
		expect(audit).toHaveBeenCalledTimes(3);
		expect(
			audit.mock.calls.map(([call]) => ({
				stage: call.stage,
				model: call.model,
				succeeded: call.response !== undefined,
			})),
		).toEqual([
			{ stage: "handler", model: "gpt-5.4-mini", succeeded: false },
			{ stage: "handler", model: "gpt-5.4", succeeded: true },
			{ stage: "continuation", model: "deepseek-v4-flash", succeeded: true },
		]);
		expect(complete).toHaveBeenCalledTimes(4);
		expect(calls.map((call) => call.model)).toEqual(["deepseek-v4-flash", "gpt-5.4-mini", "gpt-5.4", "deepseek-v4-flash"]);
	});

	it("lets OpenAI-style models re-decide client tools after a mixed private vision turn", async () => {
		let mainTurn = 0;
		const complete = jest.fn(async (model: string, messages: any[]) => {
			if (model === "gpt-5.4-mini") {
				return completion({ role: "assistant", content: "The screenshot shows a broken image icon." });
			}
			mainTurn++;
			if (mainTurn === 1) {
				return completion({
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call_private",
							type: "function",
							function: {
								name: PRIVATE_VISION_TOOL_NAME,
								arguments: JSON.stringify({
									image_refs: [IMAGE_REF],
									question: "What failure is visible?",
								}),
							},
						},
						{
							id: "call_read",
							type: "function",
							function: { name: "Read", arguments: '{"file_path":"src/view.tsx"}' },
						},
					],
				});
			}
			const hiddenAssistant = [...messages].reverse().find((message: Record<string, unknown>) => message["role"] === "assistant");
			expect((hiddenAssistant?.["tool_calls"] as Array<{ function: { name: string } }>).map((call) => call.function.name)).toEqual([
				PRIVATE_VISION_TOOL_NAME,
			]);
			expect(JSON.stringify(messages)).toContain("broken image icon");
			return completion({
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "call_read_after_vision",
						type: "function",
						function: { name: "Read", arguments: '{"file_path":"src/view.tsx"}' },
					},
				],
			});
		});

		const result = await runOpenAIVisionAgentLoop(
			fakeRouter(),
			"deepseek-v4-flash",
			[
				{
					role: "user",
					content: [
						{ type: "text", text: "Fix the screenshot problem" },
						{ type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
					],
				},
			],
			{
				tools: [
					{
						type: "function",
						function: {
							name: "Read",
							description: "Read a file",
							parameters: { type: "object" },
						},
					},
				],
			},
			complete,
		);

		const finalMessage = (result["choices"] as Array<{ message: Record<string, unknown> }>)[0]!.message;
		expect((finalMessage["tool_calls"] as Array<{ function: { name: string } }>)[0]!.function.name).toBe("Read");
		expect(JSON.stringify(stripInternalFields(result))).not.toContain(PRIVATE_VISION_TOOL_NAME);
		expect(mainTurn).toBe(2);
	});

	it("injects only when both the global switch and model selection allow vision", async () => {
		jest.mocked(dbConfigProvider.getParam).mockResolvedValueOnce({
			vision: { enabled: false, handler_model: "gpt-5.4-mini" },
		});
		await expect(
			prepareOpenAIVisionRequest(fakeRouter(), "deepseek-v4-flash", [
				{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }] },
			]),
		).resolves.toBeUndefined();

		const modelWithoutSelection = deployment();
		modelWithoutSelection.model_info!.enabled_builtin_capabilities = [];
		const router = {
			getDeployments: () => [
				modelWithoutSelection,
				{
					model_name: "gpt-5.4-mini",
					litellm_params: { model: "openai/gpt-5.4-mini" },
					model_info: { supports_vision: true },
				},
			],
			resolveModelGroupWithTrace: (model: string) => ({
				inputModel: model,
				resolvedModel: model,
				resolutionPath: [model],
			}),
		} as unknown as Router;
		await expect(
			prepareOpenAIVisionRequest(router, "deepseek-v4-flash", [
				{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }] },
			]),
		).resolves.toBeUndefined();
	});

	it("does not call the worker when the main model decides pixels are irrelevant", async () => {
		const complete = jest.fn(async () => completion({ role: "assistant", content: "No inspection needed." }));
		await runOpenAIVisionAgentLoop(
			fakeRouter(),
			"deepseek-v4-flash",
			[{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,abc" } }] }],
			{},
			complete,
		);
		expect(complete).toHaveBeenCalledTimes(1);
	});

	it("unconditionally injects the OpenAI private tool without inventing image references", async () => {
		jest.mocked(dbConfigProvider.getParam).mockResolvedValueOnce({
			vision: {
				enabled: true,
				always_inject: true,
				handler_model: "gpt-5.4-mini",
				fallback_models: [],
				max_iterations: 3,
				max_output_tokens: 1024,
			},
		});
		const complete = jest.fn(async (_model: string, messages: any[], params: Record<string, unknown>) => {
			expect(JSON.stringify(params["tools"])).toContain(PRIVATE_VISION_TOOL_NAME);
			expect(JSON.stringify(messages)).toContain("No private image references are currently available");
			expect(JSON.stringify(messages)).not.toContain("[Private image reference:");
			return completion({ role: "assistant", content: "No image is needed for this answer." });
		});

		const result = await runOpenAIVisionAgentLoop(
			fakeRouter(),
			"deepseek-v4-flash",
			[{ role: "user", content: "Explain the API in text." }],
			{},
			complete,
		);

		expect(complete).toHaveBeenCalledTimes(1);
		expect((result["choices"] as Array<{ message: { content: string } }>)[0]!.message.content).toBe(
			"No image is needed for this answer.",
		);
	});

	it("unconditionally injects the Anthropic private tool when no image is present", async () => {
		jest.mocked(dbConfigProvider.getParam).mockResolvedValueOnce({
			vision: {
				enabled: true,
				always_inject: true,
				handler_model: "gpt-5.4-mini",
				fallback_models: [],
				max_iterations: 3,
				max_output_tokens: 1024,
			},
		});

		const prepared = await prepareAnthropicVisionRequest(fakeRouter(), "deepseek-v4-flash", {
			model: "deepseek-v4-flash",
			messages: [{ role: "user", content: [{ type: "text", text: "Explain the API in text." }] }],
		});

		expect(prepared).toBeDefined();
		expect(prepared!.images.size).toBe(0);
		expect(JSON.stringify(prepared!.body["tools"])).toContain(PRIVATE_VISION_TOOL_NAME);
		expect(JSON.stringify(prepared!.body["system"])).toContain("No private image references are currently available");
	});

	it("does not expose the private tool name when model-authored image arguments are invalid", async () => {
		let error: unknown;
		try {
			await executeVisionToolCall(
				fakeRouter(),
				{
					alwaysInject: false,
					handlerModel: "gpt-5.4-mini",
					fallbackModels: [],
					maxIterations: 3,
					maxOutputTokens: 1024,
				},
				new Map(),
				"{invalid",
			);
		} catch (caught) {
			error = caught;
		}

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain("图片检查参数");
		expect((error as Error).message).not.toContain(PRIVATE_VISION_TOOL_NAME);
	});

	it("returns a model-visible result when a tool supplies a path without image bytes", async () => {
		const result = await executeVisionToolCall(
			fakeRouter(),
			{
				alwaysInject: true,
				handlerModel: "gpt-5.4-mini",
				fallbackModels: [],
				maxIterations: 3,
				maxOutputTokens: 1024,
			},
			new Map(),
			JSON.stringify({
				image_refs: ["/root/var/src/github/litellm/docs/my-website/img/locust.png"],
				question: "What is in this image?",
			}),
		);

		expect(result.attempts).toEqual([]);
		expect(result.raw).toEqual({
			error: {
				type: "image_reference_unavailable",
				references: ["/root/var/src/github/litellm/docs/my-website/img/locust.png"],
			},
		});
		expect(result.text).toContain("client-side filesystem path");
	});

	it("maps a client path back to the only image bytes in the request", async () => {
		const complete = jest.fn(async () => completion({ role: "assistant", content: "The image contains a chart." }));
		const result = await executeVisionToolCall(
			fakeRouter(),
			{
				alwaysInject: false,
				handlerModel: "gpt-5.4-mini",
				fallbackModels: [],
				maxIterations: 3,
				maxOutputTokens: 1024,
			},
			new Map([["image_1", { ref: "image_1", chatPart: { type: "image_url", image_url: { url: "data:image/png;base64,abc" } } }]]),
			JSON.stringify({ image_refs: ["/tmp/chart.png"], question: "What is shown?" }),
			complete,
		);

		expect(result.text).toBe("The image contains a chart.");
		expect(complete).toHaveBeenCalledTimes(1);
		expect(JSON.stringify((complete.mock.calls[0] as unknown[] | undefined)?.[1])).toContain("data:image/png;base64,abc");
	});

	it("loads a content-hash image from the backing store when it is absent from the request-local map", async () => {
		const imageStore = new MemoryVisionImageStore();
		const stored = await imageStore.put({ mediaType: "image/png", base64Data: "abc" });
		const complete = jest.fn(async () => completion({ role: "assistant", content: "Loaded from persistent storage." }));

		const result = await executeVisionToolCall(
			fakeRouter(),
			{
				alwaysInject: false,
				handlerModel: "gpt-5.4-mini",
				fallbackModels: [],
				maxIterations: 3,
				maxOutputTokens: 1024,
			},
			new Map(),
			JSON.stringify({ image_refs: [stored.ref], question: "What is shown?" }),
			complete,
			{ imageStore: imageStore },
		);

		expect(result.text).toBe("Loaded from persistent storage.");
		expect(JSON.stringify((complete.mock.calls[0] as unknown[] | undefined)?.[1])).toContain("data:image/png;base64,abc=");
	});

	it("runs the same private loop for Anthropic Messages", async () => {
		const prepared = await prepareAnthropicVisionRequest(fakeRouter(), "deepseek-v4-flash", {
			model: "deepseek-v4-flash",
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "Read the badge" },
						{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
					],
				},
			],
		});
		expect(prepared).toBeDefined();
		let turn = 0;
		const completeNative = jest.fn(async (body: Record<string, unknown>) => {
			turn++;
			expect(JSON.stringify(body)).not.toContain('"data":"abc"');
			if (turn === 1) {
				return {
					id: "msg_truncated",
					type: "message",
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_truncated",
							name: PRIVATE_VISION_TOOL_NAME,
							input: {},
						},
					],
					stop_reason: "max_tokens",
					usage: { input_tokens: 1, output_tokens: 1 },
				};
			}
			if (turn === 2) {
				expect(body["max_tokens"]).toBe(512);
				return {
					id: "msg_1",
					type: "message",
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_1",
							name: PRIVATE_VISION_TOOL_NAME,
							input: JSON.stringify({
								image_refs: [IMAGE_REF],
								question: "What text is on the badge?",
							}),
						},
					],
					stop_reason: "tool_use",
					usage: { input_tokens: 1, output_tokens: 1 },
				};
			}
			expect(JSON.stringify(body)).toContain("ALPHA");
			return {
				id: "msg_2",
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: "The badge says ALPHA." }],
				stop_reason: "end_turn",
				usage: { input_tokens: 2, output_tokens: 2 },
			};
		});
		const router = fakeRouter() as unknown as {
			completion: jest.Mock;
		};
		router.completion = jest.fn(async (_model: string, messages: unknown) => {
			expect(JSON.stringify(messages)).toContain("data:image/png;base64,abc=");
			return completion({ role: "assistant", content: "ALPHA" }, { prompt_tokens: 40, completion_tokens: 60, total_tokens: 100 });
		});
		const audit = jest.fn(async (call: VisionCapabilityModelCall) => ({ requestId: `child-${call.model}` }));
		const result = await runAnthropicVisionAgentLoop(router as unknown as Router, prepared!, completeNative, audit);
		expect(JSON.stringify(stripInternalFields(result.response))).not.toContain(PRIVATE_VISION_TOOL_NAME);
		expect(result.response["content"]).toEqual([{ type: "text", text: "The badge says ALPHA." }]);
		expect(result.response["usage"]).toEqual({ input_tokens: 4, output_tokens: 4 });
		expect(audit).toHaveBeenCalledTimes(2);
		expect(audit.mock.calls.map(([call]) => ({ stage: call.stage, callType: call.callType, model: call.model }))).toEqual([
			{ stage: "handler", callType: "acompletion", model: "gpt-5.4-mini" },
			{ stage: "continuation", callType: "amessages", model: "deepseek-v4-flash" },
		]);
		expect(completeNative).toHaveBeenCalledTimes(3);
	});

	it("lets Anthropic models re-decide client tools after a mixed private vision turn", async () => {
		const prepared = await prepareAnthropicVisionRequest(fakeRouter(), "deepseek-v4-flash", {
			model: "deepseek-v4-flash",
			tools: [{ name: "Agent", description: "Launch an agent", input_schema: { type: "object" } }],
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "Investigate this screenshot" },
						{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
					],
				},
			],
		});
		expect(prepared).toBeDefined();

		const router = fakeRouter() as unknown as { completion: jest.Mock };
		router.completion = jest.fn(async () => completion({ role: "assistant", content: "The screenshot shows a broken image icon." }));
		let turn = 0;
		const completeNative = jest.fn(async (body: Record<string, unknown>) => {
			turn++;
			if (turn === 1) {
				return {
					id: "msg_mixed",
					type: "message",
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_private",
							name: PRIVATE_VISION_TOOL_NAME,
							input: { image_refs: [IMAGE_REF], question: "What failure is visible?" },
						},
						{
							type: "tool_use",
							id: "toolu_agent",
							name: "Agent",
							input: { description: "Inspect logs", prompt: "Find the failure" },
						},
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
			expect(hiddenToolNames).toEqual([PRIVATE_VISION_TOOL_NAME]);
			expect(JSON.stringify(messages)).toContain("broken image icon");
			return {
				id: "msg_public_tool",
				type: "message",
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_agent_after_vision",
						name: "Agent",
						input: { description: "Inspect logs", prompt: "Find the failure" },
					},
				],
				stop_reason: "tool_use",
				usage: { input_tokens: 2, output_tokens: 2 },
			};
		});

		const result = await runAnthropicVisionAgentLoop(router as unknown as Router, prepared!, completeNative);

		expect(result.response["content"]).toEqual([
			expect.objectContaining({ type: "tool_use", name: "Agent", id: "toolu_agent_after_vision" }),
		]);
		expect(JSON.stringify(stripInternalFields(result.response))).not.toContain(PRIVATE_VISION_TOOL_NAME);
		expect(turn).toBe(2);
	});
});
