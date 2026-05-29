/**
 * DeepSeek Provider 单元测试
 *
 * 测试 DeepSeek 消息规范化（Patch 4+5）和请求转换。
 * normalizeMessages 同时应用 Patch 4 和 Patch 5，测试必须覆盖两者。
 */

import { DeepSeekProvider } from "./DeepSeekProvider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textBlock(text: string): Record<string, unknown> {
	return { type: "text", text: text };
}

function toolUseBlock(id: string, name = "tool"): Record<string, unknown> {
	return { type: "tool_use", id: id, name: name, input: {} };
}

function toolResultBlock(toolUseId: string, content: Record<string, unknown>[] | string = "done"): Record<string, unknown> {
	return { type: "tool_result", tool_use_id: toolUseId, content: content };
}

function serverToolUseBlock(id: string, name = "tool"): Record<string, unknown> {
	return { type: "server_tool_use", id: id, name: name, input: {} };
}

function thinkingBlock(thinking = "", signature = ""): Record<string, unknown> {
	return { type: "thinking", thinking: thinking, signature: signature };
}

function assistant(blocks: Record<string, unknown>[] | string): Record<string, unknown> {
	return { role: "assistant", content: blocks };
}

function user(content: Record<string, unknown>[] | string): Record<string, unknown> {
	return { role: "user", content: content };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DeepSeekProvider", () => {
	let provider: DeepSeekProvider;

	beforeEach(() => {
		provider = new DeepSeekProvider();
	});

	// -----------------------------------------------------------------------
	// transformRequest -- 基础
	// -----------------------------------------------------------------------

	describe("transformRequest", () => {
		it("returns a basic OpenAI-compatible request (inherited from base)", () => {
			const result = provider.transformRequest("deepseek-chat", [{ role: "user", content: "hi" }], { temperature: 0.7 });

			expect(result.method).toBe("POST");
			expect(result.headers["Content-Type"]).toBe("application/json");
			expect((result.body as Record<string, unknown>).model).toBe("deepseek-chat");
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

		it("keeps model name as-is when deepseek-reasoner is passed", () => {
			const result = provider.transformRequest("deepseek-reasoner", [{ role: "user", content: "hi" }], {});

			expect(result.url).toBe("https://api.deepseek.com/beta/chat/completions");
			expect((result.body as Record<string, unknown>).model).toBe("deepseek-reasoner");
		});
	});

	// -----------------------------------------------------------------------
	// normalizeMessages -- Patch 4 + Patch 5 同时生效
	// -----------------------------------------------------------------------

	describe("normalizeMessages [Patch 4 + Patch 5]", () => {
		it("moves tool_result from assistant to user message and injects thinking", () => {
			const messages = [assistant([textBlock("a"), toolUseBlock("id1"), toolResultBlock("id1")]), user([textBlock("next")])];

			provider.normalizeMessages(messages);

			expect(messages).toEqual([
				assistant([thinkingBlock(), textBlock("a"), toolUseBlock("id1")]),
				user([toolResultBlock("id1"), textBlock("next")]),
			]);
		});

		it("reorders assistant content so text comes before all tool_use blocks when tool_results are present", () => {
			const messages = [
				assistant([toolUseBlock("A"), textBlock("mid"), toolUseBlock("B"), toolResultBlock("A"), toolResultBlock("B")]),
				user("next"),
			];

			provider.normalizeMessages(messages);

			expect(messages).toEqual([
				assistant([thinkingBlock(), textBlock("mid"), toolUseBlock("A"), toolUseBlock("B")]),
				user([toolResultBlock("A"), toolResultBlock("B")]),
				user("next"),
			]);
		});

		it("converts server_tool_use to tool_use and extracts tool_results", () => {
			const messages = [assistant([serverToolUseBlock("s1"), toolResultBlock("s1")]), user([textBlock("next")])];

			provider.normalizeMessages(messages);

			expect(messages).toEqual([assistant([thinkingBlock(), toolUseBlock("s1")]), user([toolResultBlock("s1"), textBlock("next")])]);
		});

		it("orders tool_results to match tool_use ID order and injects thinking", () => {
			const messages = [
				assistant([toolUseBlock("B"), toolUseBlock("A"), toolResultBlock("A", "result_a"), toolResultBlock("B", "result_b")]),
				user([textBlock("next")]),
			];

			provider.normalizeMessages(messages);

			expect(messages).toEqual([
				assistant([thinkingBlock(), toolUseBlock("B"), toolUseBlock("A")]),
				user([toolResultBlock("B", "result_b"), toolResultBlock("A", "result_a"), textBlock("next")]),
			]);
		});

		it("injects thinking even when no tool interleaving is present", () => {
			const messages = [assistant([textBlock("hello")]), user("world")];

			provider.normalizeMessages(messages);

			expect(messages).toEqual([assistant([thinkingBlock(), textBlock("hello")]), user("world")]);
		});
	});

	// -----------------------------------------------------------------------
	// normalizeMessages [Patch 5] -- thinking block 特定行为
	// -----------------------------------------------------------------------

	describe("normalizeMessages [Patch 5] — thinking", () => {
		it("preserves existing thinking block and does not add a second one", () => {
			const messages = [assistant([thinkingBlock("I am thinking...", "sig123"), textBlock("hello")]), user("world")];

			provider.normalizeMessages(messages);

			expect(messages).toEqual([assistant([thinkingBlock("I am thinking...", "sig123"), textBlock("hello")]), user("world")]);
		});

		it("preserves redacted_thinking block and does not add a second thinking", () => {
			const messages = [
				assistant([{ type: "redacted_thinking", thinking: "redacted", signature: "sig" }, textBlock("hello")]),
				user("world"),
			];

			provider.normalizeMessages(messages);

			expect(messages).toEqual([
				assistant([{ type: "redacted_thinking", thinking: "redacted", signature: "sig" }, textBlock("hello")]),
				user("world"),
			]);
		});

		it("converts string content to block array with thinking prepended", () => {
			const messages = [assistant("hello"), user("world")];

			provider.normalizeMessages(messages);

			expect(messages).toEqual([assistant([thinkingBlock(), { type: "text", text: "hello" }]), user("world")]);
		});
	});

	// -----------------------------------------------------------------------
	// normalizeMessages -- Patch 4 + Patch 5 联合行为
	// -----------------------------------------------------------------------

	describe("normalizeMessages [Patch 4 + Patch 5 combined]", () => {
		it("applies both patches on the same messages", () => {
			const messages = [assistant([textBlock("a"), toolUseBlock("t1"), toolResultBlock("t1")]), user("next")];

			provider.normalizeMessages(messages);

			const assistantMsg = messages[0] as Record<string, unknown>;
			const assistantContent = assistantMsg.content as Record<string, unknown>[];

			expect(assistantContent[0]).toEqual(thinkingBlock());
			expect(assistantContent[1]).toEqual(textBlock("a"));
			expect(assistantContent[2]).toEqual(toolUseBlock("t1"));

			expect(messages[1]).toEqual(user([toolResultBlock("t1")]));
			expect(messages[2]).toEqual(user("next"));
		});
	});
});
