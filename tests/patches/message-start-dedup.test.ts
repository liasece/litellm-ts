/**
 * Patch 6+15: message_start 去重测试
 */
import { _isPureMessageStartChunk } from "../../src/proxy/AnthropicMessagesEndpoint";

describe("_isPureMessageStartChunk", () => {
	const msgStartSSE = 'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n';
	const msgStartBytes = new TextEncoder().encode(msgStartSSE);

	it("detects pure message_start string chunk", () => {
		expect(_isPureMessageStartChunk(msgStartSSE)).toBe(true);
	});

	it("detects pure message_start bytes chunk", () => {
		expect(_isPureMessageStartChunk(msgStartBytes)).toBe(true);
	});

	it("rejects multi-frame chunk", () => {
		const multiFrame = msgStartSSE + 'event: content_block_start\ndata: {"type":"content_block_start"}\n\n';
		expect(_isPureMessageStartChunk(multiFrame)).toBe(false);
	});

	it("rejects content_block_delta chunk", () => {
		const delta = 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n';
		expect(_isPureMessageStartChunk(delta)).toBe(false);
	});

	it("rejects non-JSON chunk", () => {
		expect(_isPureMessageStartChunk("event: message_start\ndata: not json\n\n")).toBe(false);
	});

	it("rejects non-string/non-bytes input", () => {
		expect(_isPureMessageStartChunk(42)).toBe(false);
		expect(_isPureMessageStartChunk(null)).toBe(false);
		expect(_isPureMessageStartChunk({ type: "message_start" })).toBe(false);
	});

	it("rejects empty string", () => {
		expect(_isPureMessageStartChunk("")).toBe(false);
	});

	it("rejects message_stop chunk", () => {
		const stop = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
		expect(_isPureMessageStartChunk(stop)).toBe(false);
	});
});
