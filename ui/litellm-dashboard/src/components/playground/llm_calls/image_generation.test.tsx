import { describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
import { createPlaygroundFetch } from "../../networking";
import { makeOpenAIImageGenerationRequest } from "./image_generation";

const mockCreate = vi.fn();

vi.mock("../../networking", () => ({
	getProxyBaseUrl: vi.fn(() => "https://example.com"),
	createPlaygroundFetch: vi.fn(() => vi.fn()),
}));
vi.mock("openai");

describe("image_generation", () => {
	it("injects the OpenAI playground transport while preserving the generation payload", async () => {
		mockCreate.mockResolvedValue({ data: [{ url: "https://example.com/image.png" }] });
		(OpenAI as any).mockImplementation(() => ({ images: { generate: mockCreate } }));
		const updateUI = vi.fn();

		await makeOpenAIImageGenerationRequest("A fox", updateUI, "gpt-image-1", { kind: "session" }, ["demo"]);

		expect(createPlaygroundFetch).toHaveBeenCalledWith({ kind: "session" }, "openai");
		expect(OpenAI).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "playground-session",
				fetch: expect.any(Function),
				defaultHeaders: { "x-litellm-tags": "demo" },
			}),
		);
		expect(mockCreate).toHaveBeenCalledWith({ model: "gpt-image-1", prompt: "A fox" }, { signal: undefined });
		expect(updateUI).toHaveBeenCalledWith("https://example.com/image.png", "gpt-image-1");
	});
});
