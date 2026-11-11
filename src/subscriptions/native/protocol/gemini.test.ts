/**
 * Gemini 工具调用签名与 ID 往返测试。
 */

import { decodeGeminiResponse, encodeGeminiResponse } from "./convert/gemini";

it("functionCall 的 id 与 thoughtSignature 能往返", () => {
	const decoded = decodeGeminiResponse(
		{
			responseId: "resp-1",
			candidates: [
				{
					content: {
						role: "model",
						parts: [
							{
								thoughtSignature: "sig-1",
								functionCall: { id: "call-1", name: "lookup", args: { q: "x" } },
							},
						],
					},
					finishReason: "STOP",
				},
			],
			usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
		},
		"gemini-3",
	);
	const call = decoded.parts[0];
	expect(call).toMatchObject({ type: "tool_call", id: "call-1", name: "lookup", signature: "sig-1" });

	const encoded = encodeGeminiResponse(decoded, "gemini-3");
	const parts = (encoded["candidates"] as Record<string, unknown>[])[0]?.["content"] as Record<string, unknown>;
	const first = (parts["parts"] as Record<string, unknown>[])[0];
	expect(first?.["thoughtSignature"]).toBe("sig-1");
	expect(first?.["functionCall"]).toMatchObject({ id: "call-1", name: "lookup", args: { q: "x" } });
});
