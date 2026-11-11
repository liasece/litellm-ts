import { classifySignatureFamily, isDefinitelyForeignSignature } from "./signatureCompatibility";
import {
	GEMINI_SKIP_THOUGHT_SIGNATURE_VALIDATOR,
	sanitizeClaudeMessagesSignatures,
	sanitizeGeminiRequestSignatures,
	sanitizeXaiResponsesInput,
} from "./signatureTargets";

/** 外来 DeepSeek 风格签名。 */
const FOREIGN_UUID = "0279f465-965e-4262-8138-3fe1bb64d27f";

/** 生成 Claude E 信封：field 2 容器 + field 3=1。 */
function claudeEnvelope(): string {
	const container = Buffer.from([0x0a, 0x01, 0x00]);
	return Buffer.concat([Buffer.from([0x12, container.length]), container, Buffer.from([0x18, 0x01])]).toString("base64");
}

/** 生成 Gemini E 信封：只有 field 2 容器。 */
function geminiEnvelope(): string {
	const container = Buffer.from([0x0a, 0x01, 0x00]);
	return Buffer.concat([Buffer.from([0x12, container.length]), container]).toString("base64");
}

/** 读取对象字段为对象。 */
function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** 读取对象数组字段。 */
function records(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.map(asRecord) : [];
}

describe("isDefinitelyForeignSignature", () => {
	test("识别 Codex、DeepSeek、压缩胶囊与 Kimi 固定长度签名", () => {
		expect(isDefinitelyForeignSignature("gAAAA-not-a-real-payload")).toBe(true);
		expect(isDefinitelyForeignSignature(FOREIGN_UUID)).toBe(true);
		expect(isDefinitelyForeignSignature("cpa-ag-compact-v1:abc")).toBe(true);
		expect(isDefinitelyForeignSignature("A".repeat(4340))).toBe(true);
		expect(isDefinitelyForeignSignature("A".repeat(12946))).toBe(true);
	});

	test("按 protobuf 信封区分 Claude E 与 Gemini E", () => {
		expect(classifySignatureFamily(claudeEnvelope())).toBe("claude");
		expect(classifySignatureFamily(geminiEnvelope())).toBe("gemini");
		const claude = claudeEnvelope();
		expect(classifySignatureFamily(Buffer.from(claude, "ascii").toString("base64"))).toBe("claude");
		expect(classifySignatureFamily(Buffer.from([0x08, 0x01]).toString("base64"))).toBe("claude");
	});

	test("不把可能属于 Claude/Gemini 的 base64 一律判为外来", () => {
		expect(isDefinitelyForeignSignature("Eabc")).toBe(false);
		expect(isDefinitelyForeignSignature("Rabc")).toBe(false);
		expect(isDefinitelyForeignSignature("Qabc")).toBe(false);
		expect(isDefinitelyForeignSignature("Cabc")).toBe(false);
		expect(isDefinitelyForeignSignature("opaque")).toBe(false);
		expect(isDefinitelyForeignSignature("")).toBe(false);
	});
});

describe("sanitizeClaudeMessagesSignatures", () => {
	test("删除无签名/外来 thinking 与 redacted_thinking，保留 Claude 原生块", () => {
		const body: Record<string, unknown> = {
			messages: [
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "foreign", signature: FOREIGN_UUID },
						{ type: "thinking", thinking: "gemini", signature: geminiEnvelope() },
						{ type: "thinking", thinking: "unknown", signature: "opaque" },
						{ type: "thinking", thinking: "missing" },
						{ type: "thinking", thinking: "native", signature: "Eabc" },
						{ type: "redacted_thinking", data: FOREIGN_UUID },
						{ type: "redacted_thinking", data: "Eredacted" },
						{ type: "text", text: "ok" },
					],
				},
				{
					role: "assistant",
					content: [{ type: "thinking", thinking: "only-foreign", signature: FOREIGN_UUID }],
				},
			],
		};

		sanitizeClaudeMessagesSignatures(body);

		const messages = records(body["messages"]);
		expect(messages).toHaveLength(1);
		const content = records(messages[0]?.["content"]);
		expect(content).toEqual([
			{ type: "thinking", thinking: "native", signature: "Eabc" },
			{ type: "redacted_thinking", data: "Eredacted" },
			{ type: "text", text: "ok" },
		]);
	});

	test("移除 tool_use 上不属于 Claude 的签名来源字段", () => {
		const body: Record<string, unknown> = {
			messages: [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool_1",
							name: "lookup",
							input: {},
							signature: "sig",
							thoughtSignature: "sig",
							thought_signature: "sig",
							extra_content: { google: { thought_signature: "sig" } },
						},
					],
				},
			],
		};

		sanitizeClaudeMessagesSignatures(body);

		const block = records(records(body["messages"])[0]?.["content"])[0];
		expect(block).toEqual({ type: "tool_use", id: "tool_1", name: "lookup", input: {} });
	});
});

describe("sanitizeGeminiRequestSignatures", () => {
	test("首个 functionCall 缺少签名时补 bypass，后续 functionCall 与文本清除外来签名", () => {
		const request: Record<string, unknown> = {
			contents: [
				{
					role: "model",
					parts: [
						{ text: "plan", thought: true, thoughtSignature: FOREIGN_UUID },
						{ functionCall: { name: "first", args: {} }, thoughtSignature: FOREIGN_UUID },
						{ functionCall: { name: "second", args: {} }, thoughtSignature: FOREIGN_UUID },
					],
				},
			],
		};

		sanitizeGeminiRequestSignatures(request);

		const parts = records(records(request["contents"])[0]?.["parts"]);
		expect(parts[0]).toEqual({ text: "plan", thought: true });
		expect(parts[1]).toEqual({
			functionCall: { name: "first", args: {} },
			thoughtSignature: GEMINI_SKIP_THOUGHT_SIGNATURE_VALIDATOR,
		});
		expect(parts[2]).toEqual({ functionCall: { name: "second", args: {} } });
	});

	test("首个 functionCall 没有签名时也补 bypass，原生签名保持不动", () => {
		const request: Record<string, unknown> = {
			contents: [
				{
					role: "model",
					parts: [{ functionCall: { name: "first", args: {} } }],
				},
				{
					role: "model",
					parts: [{ text: "continued", thought: true, thoughtSignature: geminiEnvelope() }],
				},
			],
		};

		sanitizeGeminiRequestSignatures(request);

		const first = records(records(request["contents"])[0]?.["parts"])[0];
		expect(first?.["thoughtSignature"]).toBe(GEMINI_SKIP_THOUGHT_SIGNATURE_VALIDATOR);
		const second = records(records(request["contents"])[1]?.["parts"])[0];
		expect(second?.["thoughtSignature"]).toBe(geminiEnvelope());
	});
});

describe("sanitizeXaiResponsesInput", () => {
	test("删除外来 reasoning/compaction，保留 xAI 原生与普通消息", () => {
		const body: Record<string, unknown> = {
			input: [
				{ type: "reasoning", encrypted_content: "gAAAA-foreign" },
				{ type: "reasoning", encrypted_content: "opaque-native" },
				{ type: "compaction", encrypted_content: FOREIGN_UUID },
				{ type: "reasoning", encrypted_content: claudeEnvelope() },
				{ type: "message", role: "user", content: "hi" },
			],
		};

		sanitizeXaiResponsesInput(body);

		const input = records(body["input"]);
		expect(input).toHaveLength(2);
		expect(input[0]).toEqual({ type: "reasoning", encrypted_content: "opaque-native" });
		expect(input[1]).toEqual({ type: "message", role: "user", content: "hi" });
	});
});
