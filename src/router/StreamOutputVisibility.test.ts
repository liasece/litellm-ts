import { hasCommittedStreamOutput } from "./StreamOutputVisibility";

/**
 * 只有「答案内容已经下发」才锁定当前候选模型。包络块、思考增量与错误块都必须允许继续 fallback。
 * 用例分别对应生产 request b28e4807（首个可见增量前断流）与 f2dd8cd7（思考增量之后断流）。
 */
function chatChunk(delta: Record<string, unknown>): Record<string, unknown> {
	return { choices: [{ index: 0, delta: delta, finish_reason: null }] };
}

describe("hasCommittedStreamOutput", () => {
	it("treats chat envelope blocks as no committed answer", () => {
		expect(hasCommittedStreamOutput(chatChunk({ role: "assistant" }))).toBe(false);
		expect(hasCommittedStreamOutput({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })).toBe(false);
		expect(hasCommittedStreamOutput({ choices: [], usage: { total_tokens: 12, cost: 0.01 } })).toBe(false);
		expect(hasCommittedStreamOutput({ error: "terminated" })).toBe(false);
	});

	it("does not commit on reasoning-only increments", () => {
		expect(hasCommittedStreamOutput(chatChunk({ reasoning_content: "思考" }))).toBe(false);
		expect(hasCommittedStreamOutput(chatChunk({ reasoning_content: " " }))).toBe(false);
		expect(hasCommittedStreamOutput(chatChunk({ thinking_blocks: [{ type: "thinking", thinking: "deep" }] }))).toBe(false);
	});

	it("commits on answer, refusal and tool call increments", () => {
		expect(hasCommittedStreamOutput(chatChunk({ content: "Hi" }))).toBe(true);
		expect(hasCommittedStreamOutput(chatChunk({ refusal: "No" }))).toBe(true);
		const toolCallDelta = { tool_calls: [{ index: 0, function: { name: "run_code", arguments: "{}" } }] };
		expect(hasCommittedStreamOutput(chatChunk(toolCallDelta))).toBe(true);
	});

	it("treats native Responses envelope and reasoning events as no committed answer", () => {
		expect(hasCommittedStreamOutput({ type: "response.created", response: { id: "resp_1" } })).toBe(false);
		expect(hasCommittedStreamOutput({ type: "response.in_progress" })).toBe(false);
		expect(hasCommittedStreamOutput({ type: "response.output_item.added", item: { id: "msg_1" } })).toBe(false);
		expect(hasCommittedStreamOutput({ type: "response.reasoning_text.delta", delta: "思考" })).toBe(false);
		expect(hasCommittedStreamOutput({ type: "response.reasoning_text.done", text: "思考" })).toBe(false);
		expect(
			hasCommittedStreamOutput({ type: "response.output_item.done", item: { type: "reasoning", id: "rs_1" } }),
		).toBe(false);
	});

	it("commits on native Responses answer deltas", () => {
		expect(hasCommittedStreamOutput({ type: "response.output_text.delta", delta: "" })).toBe(false);
		expect(hasCommittedStreamOutput({ type: "response.output_text.delta", delta: "Hi" })).toBe(true);
		expect(hasCommittedStreamOutput({ type: "response.function_call_arguments.delta", delta: "{}" })).toBe(true);
		expect(hasCommittedStreamOutput({ type: "response.output_item.done", item: { type: "message", id: "msg_1" } })).toBe(true);
	});

	it("treats a whole-text fallback chunk as a committed answer", () => {
		expect(hasCommittedStreamOutput("provider does not support streaming")).toBe(true);
		expect(hasCommittedStreamOutput("")).toBe(false);
	});
});
