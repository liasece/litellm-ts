import type { Router } from "../router/Router";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import {
	PRIVATE_IMAGE_CREATE_TOOL_NAME,
	PRIVATE_IMAGE_EDIT_TOOL_NAME,
	prepareOpenAIImageGenerationRequest,
	runOpenAIImageGenerationAgentLoop,
} from "./ImageGenerationCapability";
import { MemoryVisionImageStore } from "./VisionImageStore";

function completion(message: Record<string, unknown>) {
	return {
		id: "chatcmpl-image-capability",
		object: "chat.completion",
		created: 1,
		model: "text-model",
		choices: [{ index: 0, finish_reason: "stop", message: message }],
		usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
	};
}

function fakeRouter(overrides: Partial<Router> = {}): Router {
	return {
		getDeployments: () => [
			{
				model_name: "text-model",
				litellm_params: { model: "cliproxy/gpt-5.6" },
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
				usage: { input_tokens: 7, output_tokens: 11, total_tokens: 18 },
			};
		});
		const router = fakeRouter({ imageGeneration } as unknown as Partial<Router>);
		const complete = jest
			.fn()
			.mockResolvedValueOnce(
				completion({
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
				}),
			)
			.mockImplementationOnce(async (_model, messages) => {
				const toolMessage = messages.find((message: Record<string, unknown>) => message["role"] === "tool");
				expect(JSON.parse(String(toolMessage?.["content"]))).toMatchObject({ status: "completed", action: "create" });
				expect(JSON.stringify(messages)).not.toContain("AA==");
				return completion({ role: "assistant", content: "I created the requested image." });
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
		const message = (result["choices"] as Array<Record<string, unknown>>)[0]!["message"] as Record<string, unknown>;
		expect(message["content"]).toBe("I created the requested image.");
		expect(message["image"]).toMatchObject({ url: "data:image/png;base64,AA==" });
		expect(result["_builtinGeneratedImages"]).toEqual([
			expect.objectContaining({ action: "create", b64Json: "AA==", model: "image-fallback" }),
		]);
	});

	it("replaces attached bytes with a reference and sends them only to imageEdit", async () => {
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
		expect(JSON.stringify(prepared!.messages)).not.toContain("YWJj");
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

		expect((router.imageEdit as jest.Mock)).toHaveBeenCalledTimes(1);
		expect(result["_builtinGeneratedImages"]).toEqual([expect.objectContaining({ action: "edit", outputFormat: "webp" })]);
	});
});
