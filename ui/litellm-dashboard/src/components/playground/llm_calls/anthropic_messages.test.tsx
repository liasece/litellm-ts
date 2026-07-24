import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { createPlaygroundFetch } from "../../networking";
import { makeAnthropicMessagesRequest } from "./anthropic_messages";

const mockStream = vi.fn();

vi.mock("../../networking", () => ({
	getProxyBaseUrl: vi.fn(() => "https://example.com"),
	createPlaygroundFetch: vi.fn(() => vi.fn()),
}));
vi.mock("@anthropic-ai/sdk");

describe("anthropic_messages", () => {
	it("injects the Anthropic playground transport and preserves streaming payloads", async () => {
		async function* events() {
			yield { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } };
		}
		mockStream.mockReturnValue(events());
		(Anthropic as any).mockImplementation(() => ({ messages: { stream: mockStream } }));
		const updateTextUI = vi.fn();

		await makeAnthropicMessagesRequest([{ role: "user", content: "Hi" }], updateTextUI, "claude-test", {
			kind: "session",
		});

		expect(createPlaygroundFetch).toHaveBeenCalledWith({ kind: "session" }, "anthropic");
		expect(Anthropic).toHaveBeenCalledWith(
			expect.objectContaining({ apiKey: "playground-session", fetch: expect.any(Function) }),
		);
		expect(mockStream).toHaveBeenCalledWith(
			expect.objectContaining({
				model: "claude-test",
				messages: [{ role: "user", content: "Hi" }],
				stream: true,
				max_tokens: 1024,
			}),
			{ signal: undefined },
		);
		expect(updateTextUI).toHaveBeenCalledWith("assistant", "Hello", "claude-test");
	});
});
