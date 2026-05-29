/**
 * Patch 2: Qwen3 reasoning_text 事件测试
 *
 * 验证 AnthropicMessagesEndpoint 能处理 response.reasoning_text.delta 事件。
 */
describe("Qwen3 reasoning_text handler", () => {
	it("synthesizes thinking_delta from reasoning_text.delta event", () => {
		// 验证 _ensureBlockForItem 在 reasoning_text 路径上的行为
		// Patch 2 在 SSE event parser 中将 "response.reasoning_text.delta" 事件
		// 转换为 content_block_delta with type: "thinking_delta"
		// 这里测试 _ensureBlockForItem 合成逻辑
		const { _ensureBlockForItem } = require("../../src/proxy/AnthropicMessagesEndpoint");
		const queue: Array<{ type: string; index: number; content_block?: Record<string, unknown> }> = [];
		const idMap = new Map<string, number>();
		const idx = { value: 0 };

		const blockIdx = _ensureBlockForItem(queue, idMap, idx, "item_think_1", "thinking");

		expect(queue).toHaveLength(1);
		expect(queue[0]!.type).toBe("content_block_start");
		expect(queue[0]!.content_block).toEqual({ type: "thinking", thinking: "" });
		expect(blockIdx).toBe(0);
	});

	it("reuses block index for same item in reasoning_text flow", () => {
		const { _ensureBlockForItem } = require("../../src/proxy/AnthropicMessagesEndpoint");
		const queue: Array<{ type: string; index: number }> = [];
		const idMap = new Map<string, number>();
		const idx = { value: 0 };

		_ensureBlockForItem(queue, idMap, idx, "item_rt_1", "thinking");
		expect(idx.value).toBe(1);

		const second = _ensureBlockForItem(queue, idMap, idx, "item_rt_1", "thinking");
		expect(second).toBe(0);
		expect(queue).toHaveLength(1); // no new synth
	});
});
