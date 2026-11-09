import type { Router } from "../router/Router";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import {
	PRIVATE_IMAGE_CREATE_TOOL_NAME,
	PRIVATE_IMAGE_EDIT_TOOL_NAME,
	prepareOpenAIImageGenerationRequest,
	runAnthropicImageGenerationAgentLoop,
	runOpenAIImageGenerationAgentLoop,
} from "./ImageGenerationCapability";
import { MemoryVisionImageStore } from "./VisionImageStore";

function completion(
	message: Record<string, unknown>,
	usage: Record<string, unknown> = { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
) {
	return {
		id: "chatcmpl-image-capability",
		object: "chat.completion",
		created: 1,
		model: "text-model",
		choices: [{ index: 0, finish_reason: "stop", message: message }],
		usage: usage,
	};
}

function fakeRouter(overrides: Partial<Router> = {}): Router {
	return {
		getDeployments: () => [
			{
				model_name: "text-model",
				litellm_params: { model: "gpt-5.6" },
				model_info: { supports_function_calling: true, enabled_builtin_capabilities: ["image_generation"] },
			},
		],
		resolveModelGroupWithTrace: (model: string) => ({ inputModel: model, resolvedModel: model, resolutionPath: [model] }),
		...overrides,
	} as unknown as Router;
}

describe("ImageGenerationCapability", () => {
	beforeEach(() => {
		jest.spyOn(dbConfigProvider, "getParam").mockResolvedValue({
			image_generation: {
				enabled: true,
				always_inject: true,
				handler_model: "image-primary",
				fallback_models: ["image-fallback"],
				max_iterations: 3,
			},
		});
	});

	afterEach(() => jest.restoreAllMocks());

	it("hides create tool turns and attaches the generated image to Chat output", async () => {
		const imageGeneration = jest.fn(async (model: string, prompt: string) => {
			if (model === "image-primary") throw new Error("primary unavailable");
			expect(prompt).toContain("orange scarf");
			return {
				created: 1,
				output_format: "png",
				data: [{ b64_json: "AA==" }],
				usage: {
					input_tokens: 7,
					output_tokens: 11,
					total_tokens: 18,
					input_tokens_details: { cached_tokens: 4 },
					output_tokens_details: { reasoning_tokens: 2 },
				},
			};
		});
		const router = fakeRouter({ imageGeneration } as unknown as Partial<Router>);
		const complete = jest
			.fn()
			.mockResolvedValueOnce(
				completion(
					{
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call-create",
								type: "function",
								function: {
									name: PRIVATE_IMAGE_CREATE_TOOL_NAME,
									arguments: JSON.stringify({ prompt: "A tabby cat with an orange scarf", quality: "high" }),
								},
							},
						],
					},
					{
						prompt_tokens: 100,
						completion_tokens: 10,
						total_tokens: 110,
						prompt_tokens_details: { cached_tokens: 80 },
						completion_tokens_details: { reasoning_tokens: 3 },
					},
				),
			)
			.mockImplementationOnce(async (_model, messages) => {
				const toolMessage = messages.find((message: Record<string, unknown>) => message["role"] === "tool");
				expect(JSON.parse(String(toolMessage?.["content"]))).toMatchObject({ status: "completed", action: "create" });
				expect(JSON.stringify(messages)).not.toContain("AA==");
				return completion(
					{ role: "assistant", content: "I created the requested image." },
					{
						prompt_tokens: 200,
						completion_tokens: 20,
						total_tokens: 220,
						prompt_tokens_details: { cached_tokens: 160 },
						completion_tokens_details: { reasoning_tokens: 7 },
					},
				);
			});

		const result = await runOpenAIImageGenerationAgentLoop(
			router,
			"text-model",
			[{ role: "user", content: "Draw a cat wearing an orange scarf" }],
			{},
			complete,
			{ imageStore: new MemoryVisionImageStore() },
		);

		expect(imageGeneration).toHaveBeenCalledTimes(2);
		expect(result["usage"]).toMatchObject({
			prompt_tokens: 307,
			completion_tokens: 41,
			total_tokens: 348,
			prompt_tokens_details: { cached_tokens: 244 },
			completion_tokens_details: { reasoning_tokens: 12 },
		});
		const message = (result["choices"] as Array<Record<string, unknown>>)[0]!["message"] as Record<string, unknown>;
		expect(message["content"]).toBe("I created the requested image.");
		expect(message["image"]).toMatchObject({ url: "data:image/png;base64,AA==" });
		expect(result["_builtinGeneratedImages"]).toEqual([
			expect.objectContaining({ action: "create", b64Json: "AA==", model: "image-fallback" }),
		]);
	});

	it("preserves main-model image input while resolving source references for imageEdit", async () => {
		const store = new MemoryVisionImageStore();
		const router = fakeRouter({
			imageEdit: jest.fn(async (_model, prompt, images) => {
				expect(prompt).toBe("Add a red hat while preserving the subject");
				expect(images).toHaveLength(1);
				expect(Buffer.from(images[0]!.data).toString("base64")).toBe("YWJj");
				return { output_format: "webp", data: [{ b64_json: "AQ==" }], usage: { total_tokens: 1 } };
			}),
		} as unknown as Partial<Router>);
		const sourceMessages = [
			{
				role: "user",
				content: [
					{ type: "text", text: "Add a red hat" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,YWJj" } },
				],
			},
		];
		const prepared = await prepareOpenAIImageGenerationRequest(router, "text-model", sourceMessages, store);
		expect(prepared!.messages.slice(1, -1)).toEqual(sourceMessages);
		expect(prepared!.tailMessageCount).toBe(1);
		expect(JSON.stringify(prepared!.messages[0])).not.toContain("sha256:");
		expect(JSON.stringify(prepared!.messages.at(-1))).toContain("sha256:");
		const ref = [...prepared!.images.keys()][0]!;
		const complete = jest
			.fn()
			.mockResolvedValueOnce(
				completion({
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call-edit",
							type: "function",
							function: {
								name: PRIVATE_IMAGE_EDIT_TOOL_NAME,
								arguments: JSON.stringify({
									prompt: "Add a red hat while preserving the subject",
									image_refs: [ref],
								}),
							},
						},
					],
				}),
			)
			.mockResolvedValueOnce(completion({ role: "assistant", content: "Edited." }));

		const result = await runOpenAIImageGenerationAgentLoop(router, "text-model", sourceMessages, {}, complete, {
			imageStore: store,
			preparedRequest: prepared,
		});

		expect(router.imageEdit as jest.Mock).toHaveBeenCalledTimes(1);
		for (const [, messages] of complete.mock.calls) {
			expect(messages.filter((message: Record<string, unknown>) => message["role"] === "user")).toEqual(sourceMessages);
		}
		expect(result["_builtinGeneratedImages"]).toEqual([expect.objectContaining({ action: "edit", outputFormat: "webp" })]);
	});

	it("keeps ordinary Chat image input intact when no image tool is called", async () => {
		const sourceMessages = [
			{ role: "system", content: "Describe the attached image." },
			{
				role: "user",
				content: [
					{ type: "text", text: "What is in this picture?" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,YWJj", detail: "high" } },
				],
			},
		];
		const originalMessages = structuredClone(sourceMessages);
		const imageEdit = jest.fn();
		const imageGeneration = jest.fn();
		const router = fakeRouter({ imageEdit, imageGeneration } as unknown as Partial<Router>);
		const complete = jest.fn(async (_model, messages) => {
			expect(messages.slice(1, -1)).toEqual(originalMessages);
			return completion({ role: "assistant", content: "A cat." });
		});

		const result = await runOpenAIImageGenerationAgentLoop(router, "text-model", sourceMessages, {}, complete, {
			imageStore: new MemoryVisionImageStore(),
		});

		expect(complete).toHaveBeenCalledTimes(1);
		expect(imageEdit).not.toHaveBeenCalled();
		expect(imageGeneration).not.toHaveBeenCalled();
		expect(result["choices"]).toMatchObject([{ message: { role: "assistant", content: "A cat." } }]);
		expect(sourceMessages).toEqual(originalMessages);
	});

	it("keeps the prompt prefix identical when a new image enters the request", async () => {
		const store = new MemoryVisionImageStore();
		const router = fakeRouter();
		const base = [
			{ role: "system", content: "You review UI screenshots." },
			{
				role: "user",
				content: [
					{ type: "text", text: "Check this screenshot" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,YWJj" } },
				],
			},
		];
		const first = await prepareOpenAIImageGenerationRequest(router, "text-model", base, store);
		const withSecondImage = [
			...base,
			{
				role: "tool",
				tool_call_id: "call-read-image",
				content: [{ type: "image_url", image_url: { url: "data:image/png;base64,ZGVm" } }],
			},
		];
		const second = await prepareOpenAIImageGenerationRequest(router, "text-model", withSecondImage, store);
		const refsOf = (prepared: typeof first): string[] =>
			String(prepared!.messages.at(-1)?.["content"]).match(/sha256:[a-f0-9]{64}/g) ?? [];

		// 读到新图片时只有末尾的引用清单变化：系统说明与客户端消息必须逐字相同，
		// 否则上游前缀缓存会在第一个 token 处整段失效。
		expect(second!.messages.slice(0, first!.messages.length - 1)).toEqual(first!.messages.slice(0, -1));
		expect(second!.messages.at(-2)).toEqual(withSecondImage.at(-1));
		expect(first!.messages.at(-1)).not.toEqual(second!.messages.at(-1));
		expect(refsOf(first)).toHaveLength(1);
		expect(refsOf(second)).toHaveLength(2);
	});

	it("preserves native and tool-result images in ordinary Anthropic conversations", async () => {
		const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "YWJj" } };
		const body = {
			model: "text-model",
			max_tokens: 256,
			system: [{ type: "text", text: "Describe the image.", cache_control: { type: "ephemeral" } }],
			messages: [
				{ role: "assistant", content: [{ type: "tool_use", id: "read-image", name: "read_file", input: { path: "/image.png" } }] },
				{
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "read-image", content: [{ type: "text", text: "File loaded." }, image] },
						{ ...image, cache_control: { type: "ephemeral" } },
					],
				},
			],
		};
		const originalBody = structuredClone(body);
		const imageEdit = jest.fn();
		const router = fakeRouter({ imageEdit } as unknown as Partial<Router>);
		const complete = jest.fn(async (requestBody) => {
			const requestMessages = requestBody["messages"] as Array<Record<string, unknown>>;
			expect(requestMessages).toHaveLength(originalBody.messages.length);
			expect(requestMessages.slice(0, -1)).toEqual(originalBody.messages.slice(0, -1));
			const originalLastContent = originalBody.messages.at(-1)?.content as Array<Record<string, unknown>>;
			const lastContent = requestMessages.at(-1)?.["content"] as Array<Record<string, unknown>>;
			expect(lastContent.slice(0, originalLastContent.length)).toEqual(originalLastContent);
			expect(String(lastContent.at(-1)?.["text"])).toContain("sha256:");
			expect(requestBody["system"]).toEqual(expect.arrayContaining(originalBody.system));
			expect(JSON.stringify(requestBody["system"])).not.toContain("sha256:");
			expect(requestBody["max_tokens"]).toBe(256);
			return { content: [{ type: "text", text: "A cat." }] };
		});

		const result = await runAnthropicImageGenerationAgentLoop(router, "text-model", body, complete, {
			imageStore: new MemoryVisionImageStore(),
		});

		expect(result.response["content"]).toEqual([{ type: "text", text: "A cat." }]);
		expect(complete).toHaveBeenCalledTimes(1);
		expect(imageEdit).not.toHaveBeenCalled();
		expect(body).toEqual(originalBody);
	});

	it("keeps Anthropic image input in both main turns while the edit worker receives the selected image", async () => {
		const sourceMessages = [
			{
				role: "user",
				content: [
					{ type: "text", text: "Add a red hat to the second image." },
					{ type: "image", source: { type: "base64", media_type: "image/png", data: "YWJj" } },
					{ type: "image", source: { type: "base64", media_type: "image/png", data: "ZGVm" } },
				],
			},
		];
		const imageEdit = jest.fn(async (_model, prompt, images) => {
			expect(prompt).toBe("Add a red hat");
			expect(images).toHaveLength(1);
			expect(Buffer.from(images[0]!.data).toString("base64")).toBe("ZGVm");
			return { output_format: "png", data: [{ b64_json: "AQ==" }], usage: { total_tokens: 1 } };
		});
		const router = fakeRouter({ imageEdit } as unknown as Partial<Router>);
		let mainTurn = 0;
		const complete = jest.fn(async (requestBody) => {
			const requestMessages = requestBody["messages"] as Array<Record<string, unknown>>;
			if (mainTurn++ === 0) {
				expect(requestMessages).toHaveLength(sourceMessages.length);
				const lastContent = requestMessages.at(-1)?.["content"] as Array<Record<string, unknown>>;
				const refs = String(lastContent.at(-1)?.["text"]).match(/sha256:[a-f0-9]{64}/g)!;
				return {
					content: [
						{
							type: "tool_use",
							id: "edit-second-image",
							name: PRIVATE_IMAGE_EDIT_TOOL_NAME,
							input: { prompt: "Add a red hat", image_refs: [refs[1]] },
						},
					],
				};
			}
			return { content: [{ type: "text", text: "Edited." }] };
		});

		const result = await runAnthropicImageGenerationAgentLoop(router, "text-model", { messages: sourceMessages }, complete, {
			imageStore: new MemoryVisionImageStore(),
		});

		expect(complete).toHaveBeenCalledTimes(2);
		expect(imageEdit).toHaveBeenCalledTimes(1);
		expect(result.response["_builtinGeneratedImages"]).toEqual([expect.objectContaining({ action: "edit" })]);
	});
});

describe("private image generation tool call recovery", () => {
	beforeEach(() => {
		jest.spyOn(dbConfigProvider, "getParam").mockResolvedValue({
			image_generation: {
				enabled: true,
				always_inject: true,
				handler_model: "image-primary",
				fallback_models: ["image-fallback"],
				max_iterations: 3,
			},
		});
	});

	afterEach(() => jest.restoreAllMocks());

	it("hands invalid create arguments back to the model instead of failing the request", async () => {
		const imageGeneration = jest.fn();
		const router = fakeRouter({ imageGeneration } as unknown as Partial<Router>);
		let mainTurn = 0;
		const complete = jest.fn(async (_model: string, messages: any[]) => {
			mainTurn++;
			if (mainTurn === 1) {
				return completion({
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call_create_invalid",
							type: "function",
							function: { name: PRIVATE_IMAGE_CREATE_TOOL_NAME, arguments: "{}" },
						},
					],
				});
			}
			const toolMessage = [...messages].reverse().find((message) => message["role"] === "tool");
			expect(toolMessage).toMatchObject({ tool_call_id: "call_create_invalid" });
			expect(String(toolMessage?.["content"])).toContain("图片生成参数缺少 prompt");
			return completion({ role: "assistant", content: "Please describe the image you want." });
		});

		const result = await runOpenAIImageGenerationAgentLoop(
			router,
			"text-model",
			[{ role: "user", content: "Draw something" }],
			{},
			complete,
			{ imageStore: new MemoryVisionImageStore() },
		);

		expect(imageGeneration).not.toHaveBeenCalled();
		expect(mainTurn).toBe(2);
		expect(JSON.stringify(result)).toContain("Please describe the image you want.");
	});
});
