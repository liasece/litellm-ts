/**
 * Patch 9: _ensureBlockForItem + tool_use 空名 guard 测试
 */
import { _ensureBlockForItem } from "../../src/proxy/AnthropicMessagesEndpoint";

interface ChunkItem {
	type: string;
	index: number;
	content_block?: Record<string, unknown>;
}

describe("_ensureBlockForItem", () => {
	it("synthesizes content_block_start for text block_type", () => {
		const queue: ChunkItem[] = [];
		const idMap = new Map<string, number>();
		const idx = { value: 0 };

		const result = _ensureBlockForItem(queue, idMap, idx, "item_1", "text");

		expect(result).toBe(0);
		expect(idx.value).toBe(1);
		expect(queue).toHaveLength(1);
		expect(queue[0]!.type).toBe("content_block_start");
		expect(queue[0]!.content_block).toEqual({ type: "text", text: "" });
	});

	it("synthesizes content_block_start for thinking block_type", () => {
		const queue: ChunkItem[] = [];
		const idMap = new Map<string, number>();
		const idx = { value: 0 };

		_ensureBlockForItem(queue, idMap, idx, "think_1", "thinking");

		expect(queue).toHaveLength(1);
		expect(queue[0]!.content_block).toEqual({ type: "thinking", thinking: "" });
	});

	it("does NOT synthesize content_block_start for tool_use", () => {
		const queue: ChunkItem[] = [];
		const idMap = new Map<string, number>();
		const idx = { value: 0 };

		_ensureBlockForItem(queue, idMap, idx, "tool_1", "tool_use");

		expect(queue).toHaveLength(0);
	});

	it("returns cached index for existing itemId", () => {
		const queue: ChunkItem[] = [];
		const idMap = new Map<string, number>([["item_1", 5]]);
		const idx = { value: 10 };

		const result = _ensureBlockForItem(queue, idMap, idx, "item_1", "text");

		expect(result).toBe(5);
		expect(queue).toHaveLength(0);
	});

	it("returns new index for undefined itemId", () => {
		const queue: ChunkItem[] = [];
		const idMap = new Map<string, number>();
		const idx = { value: 3 };

		const result = _ensureBlockForItem(queue, idMap, idx, undefined, "text");

		expect(result).toBe(3);
		expect(idx.value).toBe(4);
	});
});
