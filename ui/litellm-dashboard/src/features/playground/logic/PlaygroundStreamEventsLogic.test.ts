import { describe, expect, it, vi } from "vitest";
import {
	applyAnthropicEvent,
	applyChatChunk,
	applyResponsesEvent,
	emptyChatStream,
	emptyResponsesStream,
	finishChatStream,
} from "./PlaygroundStreamEventsLogic";
describe("provider stream semantics", () => {
	it("joins chat text, reasoning, zero cost and MCP results using call ids", () => {
		const text = vi.fn(),
			reasoning = vi.fn(),
			usage = vi.fn(),
			mcp = vi.fn(),
			state = emptyChatStream(),
			hooks = { text, reasoning, usage, mcp };
		applyChatChunk(
			{
				model: "fixture",
				choices: [
					{
						delta: {
							content: "Hello",
							reasoning_content: "Reason",
							provider_specific_fields: {
								mcp_list_tools: [{ function: { name: "lookup", parameters: { type: "object" } } }],
								mcp_tool_calls: [{ id: "a", function: { name: "lookup", arguments: "{}" } }],
							},
						},
					},
				],
			},
			hooks,
			state,
		);
		applyChatChunk(
			{
				choices: [
					{
						delta: {
							provider_specific_fields: {
								mcp_list_tools: [{ name: "ignored" }],
								mcp_call_results: [
									{ tool_call_id: "b", result: "Wrong" },
									{ tool_call_id: "a", result: "Correct" },
								],
							},
						},
					},
				],
				usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3, cost: "0" },
			},
			hooks,
			state,
		);
		finishChatStream(state, hooks);
		expect(text).toHaveBeenCalledWith("Hello", "fixture");
		expect(reasoning).toHaveBeenCalledWith("Reason");
		expect(usage).toHaveBeenCalledWith(expect.objectContaining({ cost: 0, totalTokens: 3 }));
		expect(mcp).toHaveBeenCalledTimes(2);
		expect(mcp.mock.calls[1][0].item.output).toBe("Correct");
	});
	it("retains Responses ids, tool context and failed events", () => {
		const text = vi.fn(),
			responseId = vi.fn(),
			usage = vi.fn(),
			state = emptyResponsesStream(),
			hooks = { text, responseId, usage };
		applyResponsesEvent({ type: "response.output_item.done", item: { type: "mcp_call", name: "lookup" } }, "fixture", hooks, state);
		expect(applyResponsesEvent({ type: "response.output_text.delta", delta: "Done" }, "fixture", hooks, state)).toBe(true);
		applyResponsesEvent(
			{
				type: "response.completed",
				response: { id: "resp-1", usage: { input_tokens: 5, output_tokens: 3, output_tokens_details: { reasoning_tokens: 2 } } },
			},
			"fixture",
			hooks,
			state,
		);
		expect(responseId).toHaveBeenCalledWith("resp-1");
		expect(usage).toHaveBeenCalledWith(
			expect.objectContaining({ promptTokens: 5, completionTokens: 3, reasoningTokens: 2, totalTokens: 8 }),
			"lookup",
		);
		expect(() =>
			applyResponsesEvent({ type: "response.failed", response: { error: { message: "Fixture failure" } } }, "fixture", hooks, state),
		).toThrow("Fixture failure");
	});
	it("combines Anthropic input token snapshot with the final output usage", () => {
		const text = vi.fn(),
			reasoning = vi.fn(),
			usage = vi.fn(),
			state = {};
		applyAnthropicEvent(
			{ type: "message_start", message: { usage: { input_tokens: 7 } } },
			"claude",
			{ text, reasoning, usage },
			state,
		);
		applyAnthropicEvent(
			{ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Reason" } },
			"claude",
			{ text, reasoning, usage },
			state,
		);
		applyAnthropicEvent(
			{ type: "content_block_delta", delta: { type: "text_delta", text: "Answer" } },
			"claude",
			{ text, reasoning, usage },
			state,
		);
		applyAnthropicEvent({ type: "message_delta", usage: { output_tokens: 4 } }, "claude", { text, reasoning, usage }, state);
		expect(reasoning).toHaveBeenCalledWith("Reason");
		expect(text).toHaveBeenCalledWith("Answer", "claude", "assistant");
		expect(usage).toHaveBeenCalledWith(expect.objectContaining({ promptTokens: 7, completionTokens: 4, totalTokens: 11 }));
	});
});
