/** 流式错误块文本化测试。 */

import { streamErrorPayloadMessage } from "./StreamErrorPayload";

describe("streamErrorPayloadMessage", () => {
	it("OpenAI 风格错误对象取 message，不退化成 [object Object]", () => {
		expect(
			streamErrorPayloadMessage({
				code: "invalid_request_error",
				message: "The `reasoning_text` in the thinking mode must be passed back to the API.",
			}),
		).toBe("The `reasoning_text` in the thinking mode must be passed back to the API.");
	});

	it("嵌套 {error:{message}} 逐层展开", () => {
		expect(streamErrorPayloadMessage({ type: "error", error: { message: "upstream stream terminated" } })).toBe(
			"upstream stream terminated",
		);
	});

	it("没有消息字段时保留 JSON 结构", () => {
		const text = streamErrorPayloadMessage({ type: "error", code: 500 });

		expect(text).toBe('{"type":"error","code":500}');
		expect(text).not.toContain("[object Object]");
	});

	it("字符串与 Error 直接取文本", () => {
		expect(streamErrorPayloadMessage("provider disconnected")).toBe("provider disconnected");
		expect(streamErrorPayloadMessage(new Error("tls: bad record MAC"))).toBe("tls: bad record MAC");
	});

	it("空值与无可用字段时给出可读兜底文案", () => {
		for (const payload of [undefined, null, "", {}, [], { nested: { nothing: true } }]) {
			const text = streamErrorPayloadMessage(payload);

			expect(typeof text).toBe("string");
			expect(text.length).toBeGreaterThan(0);
			expect(text).not.toContain("[object Object]");
		}
	});

	it("超长消息被截断，不把整段上游响应塞进日志", () => {
		const text = streamErrorPayloadMessage({ message: "x".repeat(5000) });

		expect(text.length).toBeLessThanOrEqual(1001);
		expect(text.endsWith("…")).toBe(true);
	});
});
