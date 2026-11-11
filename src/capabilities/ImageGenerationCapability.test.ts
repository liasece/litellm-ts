import { ImageGenerationTargets } from "./ImageGenerationTargets";
import { ApiError } from "../core/api/ApiError";
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

	it("does not buy a second image when storing a paid worker result fails", async () => {
		const imageGeneration = jest.fn().mockResolvedValue({ data: [{ b64_json: "AA==" }] });
		const imageStore = new MemoryVisionImageStore();
		jest.spyOn(imageStore, "put").mockRejectedValue(ApiError.badRequest("invalid stored bytes"));
		const complete = jest.fn().mockResolvedValue(
			completion({
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "paid_call",
						type: "function",
						function: { name: PRIVATE_IMAGE_CREATE_TOOL_NAME, arguments: JSON.stringify({ prompt: "an orange square" }) },
					},
				],
			}),
		);
		await expect(
			runOpenAIImageGenerationAgentLoop(
				fakeRouter({ imageGeneration } as unknown as Partial<Router>),
				"text-model",
				[{ role: "user", content: "draw" }],
				{},
				complete,
				{ imageStore },
			),
		).rejects.toMatchObject({ statusCode: 503 });
		expect(complete).toHaveBeenCalledTimes(1);
		expect(imageGeneration).toHaveBeenCalledTimes(1);
	});

	it("reuses a paid output when the model issues a new tool ID and rewrites its prompt even for image-only delivery", async () => {
		const imageGeneration = jest.fn().mockResolvedValue({ data: [{ b64_json: "AA==" }] });
		const router = fakeRouter({ imageGeneration } as unknown as Partial<Router>);
		let turn = 0;
		const complete = jest.fn(async () => {
			turn++;
			return completion({
				role: "assistant",
				content: null,
				tool_calls: [
					{
						type: "function",
						id: "private-" + turn,
						function: {
							name: PRIVATE_IMAGE_CREATE_TOOL_NAME,
							arguments: JSON.stringify({ prompt: "Crescent variation " + turn }),
						},
					},
				],
			});
		});
		const result = await runOpenAIImageGenerationAgentLoop(
			router,
			"text-model",
			[{ role: "user", content: "Draw only one crescent" }],
			{},
			complete,
			{ imageStore: new MemoryVisionImageStore() },
		);
		expect(imageGeneration).toHaveBeenCalledTimes(1);
		expect(complete).toHaveBeenCalledTimes(3);
		expect(result.choices).toEqual([
			expect.objectContaining({ finish_reason: "stop", message: expect.not.objectContaining({ tool_calls: expect.anything() }) }),
		]);
		expect(result._builtinGeneratedImages).toHaveLength(1);
	});

	it("finishes the requested caption after rejecting a repeat edit and preserves the cached input and tools", async () => {
		const imageGeneration = jest.fn().mockResolvedValue({ data: [{ b64_json: "AA==" }] });
		const imageEdit = jest.fn();
		const router = fakeRouter({ imageGeneration, imageEdit } as unknown as Partial<Router>);
		const user = { role: "user", content: "Draw one tree and describe it in one sentence." };
		const create = {
			type: "function",
			id: "make",
			function: { name: PRIVATE_IMAGE_CREATE_TOOL_NAME, arguments: JSON.stringify({ prompt: "tree" }) },
		};
		const repeat = {
			type: "function",
			id: "repeat",
			function: { name: PRIVATE_IMAGE_EDIT_TOOL_NAME, arguments: JSON.stringify({ prompt: "the same tree" }) },
		};
		const complete = jest
			.fn()
			.mockResolvedValueOnce(completion({ role: "assistant", content: null, tool_calls: [create] }))
			.mockResolvedValueOnce(completion({ role: "assistant", content: null, tool_calls: [repeat] }))
			.mockResolvedValueOnce(completion({ role: "assistant", content: "A green tree on white." }));
		const result = await runOpenAIImageGenerationAgentLoop(router, "text-model", [user], {}, complete, {
			imageStore: new MemoryVisionImageStore(),
		});
		const [, afterCreate, afterRepeat] = complete.mock.calls;
		expect(afterRepeat![1].slice(0, afterCreate![1].length)).toEqual(afterCreate![1]);
		expect(afterRepeat![2].tools).toEqual(afterCreate![2].tools);
		for (const [call, id, status] of [
			[afterCreate!, "make", "completed"],
			[afterRepeat!, "repeat", "skipped"],
		] as const) {
			const receipt = call[1].at(-1);
			expect(receipt).toMatchObject({ role: "tool", tool_call_id: id });
			expect(JSON.parse(receipt.content)).toMatchObject({ status, output_count: 1, output_index: 1, remaining_output_indices: [] });
		}
		expect(result.choices).toMatchObject([{ message: { content: "A green tree on white." } }]);
		expect(imageGeneration).toHaveBeenCalledTimes(1);
		expect(imageEdit).not.toHaveBeenCalled();
	});

	it("keeps named public calls and allows a declared second output while dropping duplicate private operations in Messages", async () => {
		const imageGeneration = jest.fn().mockResolvedValue({ data: [{ b64_json: "AA==" }] });
		const router = fakeRouter({ imageGeneration } as unknown as Partial<Router>);
		const make = (id: string, index: number) => ({
			type: "tool_use",
			id,
			name: PRIVATE_IMAGE_CREATE_TOOL_NAME,
			input: { output_count: 2, output_index: index, prompt: "Tile " + id },
		});
		const publicUse = { type: "tool_use", name: "Read", id: "public-read", input: { path: "file" } };
		const complete = jest
			.fn()
			.mockResolvedValueOnce({ role: "assistant", content: [make("first", 1)], stop_reason: "tool_use" })
			.mockResolvedValueOnce({ role: "assistant", content: [make("repeat", 1), make("second", 2)], stop_reason: "tool_use" })
			.mockResolvedValueOnce({ role: "assistant", content: [make("same-output", 2), publicUse], stop_reason: "tool_use" });
		const { response } = await runAnthropicImageGenerationAgentLoop(
			router,
			"text-model",
			{ messages: [{ role: "user", content: "Draw two different tiles then read the file" }] },
			complete,
			{ imageStore: new MemoryVisionImageStore() },
		);
		expect(imageGeneration).toHaveBeenCalledTimes(2);
		expect(response.content).toEqual([publicUse]);
		expect(response.stop_reason).toBe("tool_use");
		expect(response.generated_images).toHaveLength(2);
		const transcript = JSON.stringify(complete.mock.calls[2]![0]);
		expect(transcript).not.toContain('"id":"repeat"');
		expect(transcript).toContain('"tool_use_id":"second"');
	});

	it("continues to a public Messages tool after an already-completed image call with only thinking", async () => {
		const imageGeneration = jest.fn().mockResolvedValue({ data: [{ b64_json: "AA==" }] });
		const router = fakeRouter({ imageGeneration } as unknown as Partial<Router>);
		const imageCall = (id: string) => ({ type: "tool_use", id, name: PRIVATE_IMAGE_CREATE_TOOL_NAME, input: { prompt: "A tree" } });
		const thinking = { type: "thinking", thinking: "The file still needs to be read.", signature: "signature" };
		const read = { type: "tool_use", id: "read", name: "Read", input: { path: "receipt.txt" } };
		const complete = jest
			.fn()
			.mockResolvedValueOnce({ role: "assistant", content: [imageCall("first")], stop_reason: "tool_use" })
			.mockResolvedValueOnce({ role: "assistant", content: [thinking, imageCall("repeat")], stop_reason: "tool_use" })
			.mockResolvedValueOnce({ role: "assistant", content: [read], stop_reason: "tool_use" });
		const { response } = await runAnthropicImageGenerationAgentLoop(
			router,
			"text-model",
			{
				system: "Keep the caller's policy.",
				messages: [{ role: "user", content: "Draw one tree and read the receipt." }],
			},
			complete,
			{ imageStore: new MemoryVisionImageStore() },
		);
		const [, before, after] = complete.mock.calls;
		expect(after![0].messages.slice(0, before![0].messages.length)).toEqual(before![0].messages);
		expect(after![0].system).toBe(before![0].system);
		expect(after![0].tools).toEqual(before![0].tools);
		expect(after![0].messages.at(-2).content).toEqual([thinking, imageCall("repeat")]);
		const result = after![0].messages.at(-1).content[0];
		expect(result).toMatchObject({ type: "tool_result", tool_use_id: "repeat" });
		expect(JSON.parse(result.content)).toMatchObject({ status: "skipped", remaining_output_indices: [] });
		expect(response.content).toEqual([read]);
		expect(response.generated_images).toHaveLength(1);
		expect(imageGeneration).toHaveBeenCalledTimes(1);
	});

	it("corrects an ambiguous multi-image batch before either worker runs and returns both declared image-only targets", async () => {
		const worker = jest.fn().mockResolvedValue({ data: [{ b64_json: "AA==" }] });
		const router = fakeRouter({ imageGeneration: worker } as unknown as Partial<Router>);
		const imageCall = (id: string, index: number, count?: number) => ({
			type: "function",
			id,
			function: {
				name: PRIVATE_IMAGE_CREATE_TOOL_NAME,
				arguments: JSON.stringify({ prompt: id, output_index: index, output_count: count, final_response: "images_only" }),
			},
		});
		const complete = jest
			.fn()
			.mockResolvedValueOnce(
				completion({ role: "assistant", content: null, tool_calls: [imageCall("red", 1), imageCall("blue", 1)] }),
			)
			.mockImplementationOnce(async (_model, messages) => {
				expect(worker).not.toHaveBeenCalled();
				expect(messages.slice(-2)).toEqual(
					["red", "blue"].map((id) => expect.objectContaining({ role: "tool", tool_call_id: id })),
				);
				return completion({
					role: "assistant",
					content: null,
					tool_calls: [imageCall("red-fixed", 1, 2), imageCall("blue-fixed", 2, 2)],
				});
			});
		const result = await runOpenAIImageGenerationAgentLoop(
			router,
			"text-model",
			[{ role: "user", content: "Two separate images, nothing else." }],
			{},
			complete,
			{ imageStore: new MemoryVisionImageStore() },
		);
		expect(complete).toHaveBeenCalledTimes(2);
		expect(worker).toHaveBeenCalledTimes(2);
		expect(result._builtinGeneratedImages).toHaveLength(2);
		expect(result.choices).toMatchObject([{ finish_reason: "stop", message: { content: null } }]);
		expect((result.choices as Array<{ message: { tool_calls?: unknown } }>)[0]!.message.tool_calls).toBeUndefined();
	});
	it("ends a native Messages image-only request when its attachments are ready", async () => {
		const worker = jest.fn().mockResolvedValue({ data: [{ b64_json: "AA==" }] });
		const router = fakeRouter({ imageGeneration: worker } as unknown as Partial<Router>);
		const complete = jest.fn().mockResolvedValueOnce({
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "pic",
					name: PRIVATE_IMAGE_CREATE_TOOL_NAME,
					input: { prompt: "a moon", final_response: "images_only", output_index: 1, output_count: 1 },
				},
			],
			stop_reason: "tool_use",
		});
		const { response } = await runAnthropicImageGenerationAgentLoop(
			router,
			"text-model",
			{ messages: [{ role: "user", content: "Image only." }] },
			complete,
			{ imageStore: new MemoryVisionImageStore() },
		);
		expect(response).toMatchObject({
			content: [],
			stop_reason: "end_turn",
			generated_images: [expect.objectContaining({ type: "image" })],
		});
		expect(worker).toHaveBeenCalledTimes(1);
		expect(complete).toHaveBeenCalledTimes(1);
	});

	it("rejects an image call for a verified previous slot without reattaching it during public tool continuation", async () => {
		const prior = {
			id: "imggen_" + "a".repeat(32),
			ref: "sha256:" + "a".repeat(64),
			action: "create" as const,
			mediaType: "image/png",
			outputFormat: "png" as const,
			model: "image-primary",
			target: { index: 1, count: 1 },
		};
		const targets = new ImageGenerationTargets([prior]);
		const worker = jest.fn();
		const call = {
			id: "new-call",
			type: "function",
			function: {
				name: PRIVATE_IMAGE_CREATE_TOOL_NAME,
				arguments: JSON.stringify({
					prompt: "Draw the same leaf differently",
					output_count: 1,
					output_index: 1,
					final_response: "continue",
				}),
			},
		};
		const complete = jest
			.fn()
			.mockResolvedValueOnce(completion({ role: "assistant", content: null, tool_calls: [call] }))
			.mockImplementationOnce(async (_model, messages) => {
				const receipt = JSON.parse(messages.at(-1).content);
				expect(receipt).toMatchObject({ status: "skipped", images: [{ ref: prior.ref }], remaining_output_indices: [] });
				return completion({ role: "assistant", content: "The green leaf was generated." });
			});
		const result = await runOpenAIImageGenerationAgentLoop(
			fakeRouter({ imageGeneration: worker } as unknown as Partial<Router>),
			"text-model",
			[{ role: "user", content: "One green leaf" }],
			{},
			complete,
			{ targets, imageStore: new MemoryVisionImageStore() },
		);
		expect(worker).not.toHaveBeenCalled();
		expect(result.choices).toMatchObject([{ message: { content: "The green leaf was generated." } }]);
		expect(result._builtinGeneratedImages).toHaveLength(0);
	});

	it("respects required structured output even when the private call proposes a caption", async () => {
		const imageGeneration = jest.fn().mockResolvedValue({ data: [{ b64_json: "AA==" }] });
		const complete = jest
			.fn()
			.mockResolvedValueOnce(
				completion({
					role: "assistant",
					content: null,
					tool_calls: [
						{
							type: "function",
							id: "image",
							function: {
								name: PRIVATE_IMAGE_CREATE_TOOL_NAME,
								arguments: JSON.stringify({
									prompt: "leaf",
									output_count: 1,
									output_index: 1,
									final_response: "image_and_caption",
									final_caption: "A leaf.",
								}),
							},
						},
					],
				}),
			)
			.mockResolvedValueOnce(completion({ role: "assistant", content: '{"ok":true}' }));
		const result = await runOpenAIImageGenerationAgentLoop(
			fakeRouter({ imageGeneration } as unknown as Partial<Router>),
			"text-model",
			[{ role: "user", content: "Create a leaf, reply in JSON." }],
			{ response_format: { type: "json_schema", json_schema: { name: "task", strict: true, schema: { type: "object" } } } },
			complete,
			{ imageStore: new MemoryVisionImageStore() },
		);
		expect(result.choices).toMatchObject([{ message: { content: '{"ok":true}' } }]);
		expect(complete).toHaveBeenCalledTimes(2);
		expect(imageGeneration).toHaveBeenCalledTimes(1);
	});

	it("records the OpenAI private image tool call on the response for SpendLog only", async () => {
		const imageGeneration = jest.fn(async () => ({
			output_format: "png",
			data: [{ b64_json: "AA==" }],
			usage: { total_tokens: 1 },
		}));
		const router = fakeRouter({ imageGeneration } as unknown as Partial<Router>);
		const complete = jest
			.fn()
			.mockResolvedValueOnce(
				completion({
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call-log-create",
							type: "function",
							function: {
								name: PRIVATE_IMAGE_CREATE_TOOL_NAME,
								arguments: JSON.stringify({ prompt: "A poster of a cat", quality: "high" }),
							},
						},
					],
				}),
			)
			.mockResolvedValueOnce(completion({ role: "assistant", content: "Done." }));

		const result = await runOpenAIImageGenerationAgentLoop(
			router,
			"text-model",
			[{ role: "user", content: "Draw a poster" }],
			{},
			complete,
			{ imageStore: new MemoryVisionImageStore() },
		);

		// 一次工具调用只产生一次生成，调用本身作为内部字段留在响应上供 SpendLog 记录。
		expect(imageGeneration).toHaveBeenCalledTimes(1);
		expect(result["_builtinPrivateImageToolCalls"]).toEqual([
			{
				id: "call-log-create",
				name: PRIVATE_IMAGE_CREATE_TOOL_NAME,
				arguments: { prompt: "A poster of a cat", quality: "high" },
			},
		]);
		const message = (result["choices"] as Array<Record<string, unknown>>)[0]!["message"] as Record<string, unknown>;
		expect(message["content"]).toBe("Done.");
		expect(message["tool_calls"]).toBeUndefined();
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
		expect(prepared!.messages).toHaveLength(1);
		expect((prepared!.messages[0]!.content as unknown[]).slice(0, 2)).toEqual(sourceMessages[0]!.content);
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
		const [firstTurn, continuation] = complete.mock.calls;
		expect(firstTurn![1]).toEqual(prepared!.messages);
		expect(continuation![1].slice(0, firstTurn![1].length)).toEqual(firstTurn![1]);
		expect(continuation![2].tools).toEqual(firstTurn![2].tools);
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
			expect(messages).toHaveLength(originalMessages.length);
			expect(messages[0]).toEqual(originalMessages[0]);
			expect(messages[1].content.slice(0, 2)).toEqual(originalMessages[1]!.content);
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
		// Old source references stay beside their original images, including when the next image is in a tool result.
		expect(second!.messages.slice(0, first!.messages.length)).toEqual(first!.messages);
		expect(second!.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call-read-image" });
		expect(JSON.stringify(first!.messages).match(/sha256:[a-f0-9]{64}/g)).toHaveLength(1);
		expect(JSON.stringify(second!.messages).match(/sha256:[a-f0-9]{64}/g)).toHaveLength(2);
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
			expect(lastContent[0]).toMatchObject({ type: "tool_result", tool_use_id: "read-image" });
			expect((lastContent[0]!.content as unknown[]).slice(0, 2)).toEqual(originalLastContent[0]!.content);
			expect(lastContent[1]).toEqual(originalLastContent[1]);
			expect(String(lastContent.at(-1)?.["text"])).toContain("sha256:");
			expect(requestBody["system"]).toEqual(originalBody.system);
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
			expect(requestBody).not.toHaveProperty("system");
			if (mainTurn++ === 0) {
				expect(requestMessages).toHaveLength(sourceMessages.length);
				const lastContent = requestMessages.at(-1)?.["content"] as Array<Record<string, unknown>>;
				const refs = JSON.stringify(lastContent).match(/sha256:[a-f0-9]{64}/g)!;
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

	it("records the Anthropic private image tool call without exposing it in public content", async () => {
		const imageGeneration = jest.fn(async () => ({
			output_format: "png",
			data: [{ b64_json: "AA==" }],
			usage: { total_tokens: 1 },
		}));
		const router = fakeRouter({ imageGeneration } as unknown as Partial<Router>);
		let mainTurn = 0;
		const complete = jest.fn(async () => {
			if (mainTurn++ === 0) {
				return {
					content: [
						{
							type: "tool_use",
							id: "call-log-anthropic",
							name: PRIVATE_IMAGE_CREATE_TOOL_NAME,
							input: { prompt: "A poster of a dog", size: "1024x1536" },
						},
					],
				};
			}
			return { content: [{ type: "text", text: "已生成。" }] };
		});

		const result = await runAnthropicImageGenerationAgentLoop(
			router,
			"text-model",
			{ messages: [{ role: "user", content: "画一张海报" }] },
			complete,
			{ imageStore: new MemoryVisionImageStore() },
		);

		// 主模型只发起一次调用，就只生成一次；调用记录挂在响应内部字段上，只进 SpendLog。
		expect(imageGeneration).toHaveBeenCalledTimes(1);
		expect(result.response["content"]).toEqual([{ type: "text", text: "已生成。" }]);
		expect(result.response["_builtinPrivateImageToolCalls"]).toEqual([
			{
				id: "call-log-anthropic",
				name: PRIVATE_IMAGE_CREATE_TOOL_NAME,
				arguments: { prompt: "A poster of a dog", size: "1024x1536" },
			},
		]);
		expect(JSON.stringify(result.response["content"])).not.toContain("call-log-anthropic");
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
