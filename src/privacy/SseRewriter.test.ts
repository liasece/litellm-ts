/**
 * SSE 帧还原契约：跨帧占位符、按协议改写、签名增量透传、终态补发。
 */
import { PlaceholderCodec } from "./PlaceholderCodec";
import { PlaceholderRestorer } from "./PlaceholderRestorer";
import { SseRewriter } from "./SseRewriter";

const codec = new PlaceholderCodec("test-secret");
const API_KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz";
const TOKEN = codec.token("API_KEY", API_KEY);

/**
 * 构造还原器与改写器。
 */
function makeRewriter(): SseRewriter {
	const tokens = new Map<string, string>([[TOKEN, API_KEY]]);
	return new SseRewriter(new PlaceholderRestorer({ tokens: tokens }));
}

/**
 * 组装 Chat 增量帧。
 * @param content - 增量文本
 */
function chatFrame(content: string): string {
	return `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: content } }] })}\n\n`;
}

/**
 * 解析 Chat 帧里的增量文本。
 * @param output - 输出字节
 */
function chatContents(output: string): string[] {
	const contents: string[] = [];
	for (const line of output.split("\n")) {
		if (!line.startsWith("data: ") || line.includes("[DONE]")) {
			continue;
		}
		const payload = JSON.parse(line.slice(6)) as { choices?: Array<{ delta?: { content?: string } }> };
		const content = payload.choices?.[0]?.delta?.content;
		if (typeof content === "string") {
			contents.push(content);
		}
	}
	return contents;
}

describe("SseRewriter", () => {
	it("Chat 增量跨帧拼接占位符", () => {
		const rewriter = makeRewriter();
		const first = rewriter.push(chatFrame(`hello ${TOKEN.slice(0, 8)}`));
		expect(chatContents(first).join("")).toBe("hello ");
		const second = rewriter.push(chatFrame(`${TOKEN.slice(8)} world`));
		const restored = chatContents(second).join("");
		expect(restored).toBe(`${API_KEY} world`);
	});

	it("不含占位符的帧逐字节透传", () => {
		const rewriter = makeRewriter();
		const frame = chatFrame("plain text");
		expect(rewriter.push(frame)).toBe(frame);
	});

	it("Anthropic 文本增量还原，thinking 增量透传", () => {
		const rewriter = makeRewriter();
		const textFrame = `event: content_block_delta\ndata: ${JSON.stringify({
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: TOKEN },
		})}\n\n`;
		const output = rewriter.push(textFrame);
		expect(output).toContain(API_KEY);
		expect(output).not.toContain(TOKEN);

		const thinkingFrame = `event: content_block_delta\ndata: ${JSON.stringify({
			type: "content_block_delta",
			index: 0,
			delta: { type: "thinking_delta", thinking: TOKEN },
		})}\n\n`;
		expect(rewriter.push(thinkingFrame)).toBe(thinkingFrame);
	});

	it("Anthropic 工具参数增量还原", () => {
		const rewriter = makeRewriter();
		const frame = `event: content_block_delta\ndata: ${JSON.stringify({
			type: "content_block_delta",
			index: 1,
			delta: { type: "input_json_delta", partial_json: `{"key":"${TOKEN}"}` },
		})}\n\n`;
		const output = rewriter.push(frame);
		const dataLine = output.split("\n").find((line) => line.startsWith("data: "));
		const payload = JSON.parse((dataLine ?? "data: {}").slice(6)) as { delta: { partial_json: string } };
		expect(payload.delta.partial_json).toBe(`{"key":"${API_KEY}"}`);
	});

	it("Responses 文本增量还原", () => {
		const rewriter = makeRewriter();
		const frame = `event: response.output_text.delta\ndata: ${JSON.stringify({
			type: "response.output_text.delta",
			item_id: "item_1",
			output_index: 0,
			content_index: 0,
			delta: TOKEN,
		})}\n\n`;
		const output = rewriter.push(frame);
		expect(output).toContain(API_KEY);
	});

	it("Responses 完成帧整体还原 output 文本", () => {
		const rewriter = makeRewriter();
		const frame = `event: response.completed\ndata: ${JSON.stringify({
			type: "response.completed",
			response: { id: "resp_1", output: [{ type: "message", content: [{ type: "output_text", text: TOKEN }] }] },
		})}\n\n`;
		const output = rewriter.push(frame);
		expect(output).toContain(API_KEY);
		expect(output).not.toContain(TOKEN);
	});

	it("keepalive 与 ping 帧原样保留", () => {
		const rewriter = makeRewriter();
		expect(rewriter.push(": keepalive\n\n")).toBe(": keepalive\n\n");
		const ping = `event: ping\ndata: {"type":"ping"}\n\n`;
		expect(rewriter.push(ping)).toBe(ping);
	});

	it("CRLF 分隔符保持不变", () => {
		const rewriter = makeRewriter();
		const frame = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: TOKEN } }] })}\r\n\r\n`;
		const output = rewriter.push(frame);
		expect(output.endsWith("\r\n\r\n")).toBe(true);
		expect(output).toContain(API_KEY);
	});

	it("终态之前补发被扣住的字符", () => {
		const rewriter = makeRewriter();
		const partial = TOKEN.slice(0, 6);
		rewriter.push(chatFrame(`tail ${partial}`));
		const output = rewriter.push("data: [DONE]\n\n");
		expect(output).toContain(partial);
		expect(output.trim().endsWith("[DONE]")).toBe(true);
	});

	it("finish 输出未成帧的残留字节", () => {
		const rewriter = makeRewriter();
		rewriter.push("data: ");
		expect(rewriter.finish()).toBe("data: ");
	});
});
