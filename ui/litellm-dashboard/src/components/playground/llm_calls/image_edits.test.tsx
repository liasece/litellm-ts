import { describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
import { createPlaygroundFetch } from "../../networking";
import { makeOpenAIImageEditsRequest } from "./image_edits";

const mockEdit = vi.fn();

vi.mock("../../networking", () => ({
	getProxyBaseUrl: vi.fn(() => "https://example.com"),
	createPlaygroundFetch: vi.fn(() => vi.fn()),
}));
vi.mock("openai");

describe("image_edits", () => {
	it("injects the OpenAI transport and sends each source file as multipart input", async () => {
		mockEdit.mockResolvedValue({ data: [{ b64_json: "encoded" }] });
		(OpenAI as any).mockImplementation(() => ({ images: { edit: mockEdit } }));
		const image = new File(["image"], "source.png", { type: "image/png" });
		const updateUI = vi.fn();

		await makeOpenAIImageEditsRequest(image, "Add a hat", updateUI, "gpt-image-1", { kind: "session" });

		expect(createPlaygroundFetch).toHaveBeenCalledWith({ kind: "session" }, "openai");
		expect(OpenAI).toHaveBeenCalledWith(
			expect.objectContaining({ apiKey: "playground-session", fetch: expect.any(Function) }),
		);
		expect(mockEdit).toHaveBeenCalledWith({ model: "gpt-image-1", image, prompt: "Add a hat" }, { signal: undefined });
		expect(updateUI).toHaveBeenCalledWith("data:image/png;base64,encoded", "gpt-image-1");
	});
});
