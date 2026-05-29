/**
 * DeepSeek Provider unit tests.
 *
 * Tests DeepSeek message normalization (Patch 4+5) and request conversion.
 * normalizeMessages applies both Patch 4 and Patch 5 simultaneously.
 */

import { DeepSeekProvider } from "../../src/providers/DeepSeekProvider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textBlock(text: string): Record<string, unknown> {
	return { type: "text", text };
}
function toolUseBlock(id: string, name = "tool"): Record<string, unknown> {
	return { type: "tool_use", id, name, input: {} };
}
function toolResultBlock(toolUseId: string, content: string | Record<string, unknown>[] = "done"): Record<string, unknown> {
	return { type: "tool_result", tool_use_id: toolUseId, content };
}
function serverToolUseBlock(id: string, name = "tool"): Record<string, unknown> {
	return { type: "server_tool_use", id, name, input: {} };
}
function thinkingBlock(thinking = "", signature = ""): Record<string, unknown> {
	return { type: "thinking", thinking, signature };
}
function assistant(blocks: unknown[] | string): Record<string, unknown> {
	return { role: "assistant", content: blocks };
}
function user(content: unknown): Record<string, unknown> {
	return typeof content === "string" ? { role: "user", content } : { role: "user", content };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DeepSeekProvider", () => {
	let provider: DeepSeekProvider;

	beforeEach(() => {
		provider = new DeepSeekProvider();
	});

	// -------------------------------------------------------------------
	// transformRequest -- basic
	// -------------------------------------------------------------------

	describe("transformRequest", () => {
		it("returns a basic OpenAI-compatible request (inherited from base)", () => {
			const result = provider.transformRequest("deepseek-chat", [{ role: "user", content: "hi" }], { temperature: 0.7 });

			expect(result.method).toBe("POST");
			expect(result.headers["Content-Type"]).toBe("application/json");
			expect((result.body as Record<string, unknown>).model).toBe("deepseek-chat");
			expect((result.body as Record<string, unknown>).messages).toEqual([{ role: "user", content: "hi" }]);
			expect((result.body as Record<string, unknown>).temperature).toBe(0.7);
		});

		it("uses DeepSeek API endpoint", () => {
			const result = provider.transformRequest("deepseek-chat", [{ role: "user", content: "hi" }], {});
			expect(result.url).toBe("https://api.deepseek.com/beta/chat/completions");
		});

		it("strips provider prefix from model name", () => {
			const result = provider.transformRequest("deepseek/deepseek-chat", [{ role: "user", content: "hi" }], {});
			expect((result.body as Record<string, unknown>).model).toBe("deepseek-chat");
		});

		it("keeps model name as-is when deepseek-reasoner is used", () => {
			const result = provider.transformRequest("deepseek-reasoner", [{ role: "user", content: "hi" }], {});
			expect(result.url).toBe("https://api.deepseek.com/beta/chat/completions");
			expect((result.body as Record<string, unknown>).model).toBe("deepseek-reasoner");
		});
	});

	// -------------------------------------------------------------------
	// normalizeMessages [Patch 4 + 5] -- normalizeMessages always applies both
	// -------------------------------------------------------------------

	describe("normalizeMessages [Patch 4 + 5]", () => {
		it("moves embedded tool_result from assistant to next user message", () => {
			const messages = [assistant([textBlock("a"), toolUseBlock("id1"), toolResultBlock("id1")]), user("next")];

			provider.normalizeMessages(messages);

			// Patch 4: tool_result extracted, assistant keeps text+tool_use
			// Patch 5: thinking injected, so assistant content starts with thinking
			// user("next") is string content -> pending_results become a separate user msg
			expect(messages).toEqual([
				assistant([thinkingBlock(), textBlock("a"), toolUseBlock("id1")]),
				user([toolResultBlock("id1")]),
				user("next"),
			]);
		});

			it("reorders assistant content so text comes before all tool_use blocks (when tool_results present)", () => {
			const messages = [assistant([toolUseBlock("A"), textBlock("mid"), toolResultBlock("A"), toolUseBlock("B")]), user("next")];

			provider.normalizeMessages(messages);

			// Patch 4: detects tool_results, reorders text before tool_use, extracts tool_results
			// Patch 5: thinking injected
			expect(messages).toEqual([
				assistant([thinkingBlock(), textBlock("mid"), toolUseBlock("A"), toolUseBlock("B")]),
				user([toolResultBlock("A")]),
				user("next"),
			]);
		});

		it("converts server_tool_use to tool_use and extracts embedded tool_results", () => {
			const messages = [assistant([serverToolUseBlock("s1"), toolResultBlock("s1")]), user("next")];

			provider.normalizeMessages(messages);

			expect(messages).toEqual([assistant([thinkingBlock(), toolUseBlock("s1")]), user([toolResultBlock("s1")]), user("next")]);
			const assistantContent = messages[0]!.content as Record<string, unknown>[];
			// thinking block at 0, then tool_use
			expect(assistantContent[1]!.type).toBe("tool_use");
			expect(assistantContent[1]!.id).toBe("s1");
		});

		it("orders tool_results to match tool_use ID order", () => {
			const messages = [assistant([toolUseBlock("B"), toolUseBlock("A"), toolResultBlock("B"), toolResultBlock("A")]), user("next")];

			provider.normalizeMessages(messages);

			expect(messages).toEqual([
				assistant([thinkingBlock(), toolUseBlock("B"), toolUseBlock("A")]),
				user([toolResultBlock("B"), toolResultBlock("A")]),
				user("next"),
			]);
		});

		it("injects thinking block even into messages without interleaved tool content", () => {
			const messages = [assistant([textBlock("hello")]), user("world")];

			const before = JSON.stringify(messages);
			provider.normalizeMessages(messages);

			// Patch 5 always injects thinking block for deepseek-* models
			expect(JSON.stringify(messages)).not.toBe(before);
			const assistantContent = messages[0]!.content as Record<string, unknown>[];
			expect(assistantContent[0]!.type).toBe("thinking");
		});
	});

	// -------------------------------------------------------------------
	// normalizeMessages [Patch 5] -- thinking block injection
	// -------------------------------------------------------------------

	describe("normalizeMessages [Patch 5]", () => {
		it("injects an empty thinking block into assistant message that has none", () => {
			const messages = [assistant([textBlock("hello")]), user("world")];

			provider.normalizeMessages(messages);

			expect(messages).toEqual([assistant([thinkingBlock(), textBlock("hello")]), user("world")]);
		});

		it("preserves existing thinking block and does not add a second one", () => {
			const messages = [assistant([thinkingBlock("I am thinking...", "sig123"), textBlock("hello")]), user("world")];

			provider.normalizeMessages(messages);

			expect(messages).toEqual([assistant([thinkingBlock("I am thinking...", "sig123"), textBlock("hello")]), user("world")]);
		});

		it("converts string content to block array with thinking prepended", () => {
			const messages = [assistant("hello"), user("world")];

			provider.normalizeMessages(messages);

			expect(messages).toEqual([assistant([thinkingBlock(), { type: "text", text: "hello" }]), user("world")]);
		});

		it("applies Patch 4 + Patch 5 together on the same messages", () => {
			const messages = [assistant([textBlock("a"), toolUseBlock("t1"), toolResultBlock("t1")]), user("next")];

			provider.normalizeMessages(messages);

			const assistantMsg = messages[0] as Record<string, unknown>;
			const assistantContent = assistantMsg.content as Record<string, unknown>[];
			expect(assistantContent[0]!.type).toBe("thinking");
			expect(assistantContent[1]).toEqual({ type: "text", text: "a" });
			expect(assistantContent[2]).toEqual({ type: "tool_use", id: "t1", name: "tool", input: {} });

			// tool_result goes to a separate user message (next is string content)
			const userMsg = messages[1] as Record<string, unknown>;
			expect(userMsg.content).toEqual([toolResultBlock("t1")]);
		});
	});
});
