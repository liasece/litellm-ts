import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeOpenAIEmbeddingsRequest } from "./embeddings_api";

describe("embeddings_api", () => {
	const mockUpdateEmbeddingsUI = vi.fn();
	const mockFetch = vi.fn();

	beforeEach(() => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => ({
				data: [{ embedding: [0.1, 0.2, 0.3, 0.4, 0.5], index: 0, object: "embedding" }],
				model: "text-embedding-3-small",
				object: "list",
			}),
			text: async () => "",
		} as Response);
		global.fetch = mockFetch;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		[{ kind: "session" } as const, null],
		[{ kind: "virtual-key", apiKey: "custom-key" } as const, "Bearer custom-key"],
	])("uses the final OpenAI auth header for %o", async (auth, expectedAuthorization) => {
		await makeOpenAIEmbeddingsRequest(
			"Hello, world!",
			mockUpdateEmbeddingsUI,
			"text-embedding-3-small",
			auth,
			["tag-a"],
			"https://example.com",
		);

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://example.com/embeddings");
		const headers = new Headers(options.headers);
		expect(headers.get("Content-Type")).toBe("application/json");
		expect(headers.get("x-litellm-tags")).toBe("tag-a");
		expect(headers.get("Authorization")).toBe(expectedAuthorization);
		expect(headers.get("x-api-key")).toBeNull();
		expect(options.body).toBe(JSON.stringify({ model: "text-embedding-3-small", input: "Hello, world!" }));
		expect(mockUpdateEmbeddingsUI).toHaveBeenCalledWith(
			JSON.stringify([0.1, 0.2, 0.3, 0.4, 0.5]),
			"text-embedding-3-small",
		);
	});

	it("does not include encoding_format in the payload", async () => {
		await makeOpenAIEmbeddingsRequest(
			"Sample text",
			mockUpdateEmbeddingsUI,
			"text-embedding-3-small",
			{ kind: "session" },
			[],
			"https://example.com",
		);

		const options = mockFetch.mock.calls[0][1] as RequestInit;
		expect(JSON.parse(options.body as string)).toEqual({
			model: "text-embedding-3-small",
			input: "Sample text",
		});
	});
});
