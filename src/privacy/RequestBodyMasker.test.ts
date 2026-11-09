/**
 * 请求体适配契约：只改内容字段，不动 schema / 媒体块 / 签名 thinking。
 */
import { PrivacyContext } from "./PrivacyContext";
import { parsePrivacyMaskingSettings } from "./PrivacyConfig";
import { detectPrivacyProtocol, maskRequestBody } from "./RequestBodyMasker";

const API_KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz";
const EMAIL = "jansen@liasece.com";

/**
 * 构造上下文。
 */
function makeContext(): PrivacyContext {
	return new PrivacyContext({
		settings: parsePrivacyMaskingSettings({}),
		customWords: [],
		configuredSecrets: [],
	});
}

describe("detectPrivacyProtocol", () => {
	it("按路径识别协议", () => {
		expect(detectPrivacyProtocol("/v1/chat/completions")).toBe("chat");
		expect(detectPrivacyProtocol("/chat/completions")).toBe("chat");
		expect(detectPrivacyProtocol("/v1/messages")).toBe("anthropic");
		expect(detectPrivacyProtocol("/v1/messages/count_tokens")).toBe("anthropic");
		expect(detectPrivacyProtocol("/v1/responses")).toBe("responses");
		expect(detectPrivacyProtocol("/backend-api/codex/responses")).toBe("responses");
		expect(detectPrivacyProtocol("/v1/responses/compact")).toBe("responses");
		expect(detectPrivacyProtocol("/v1/completions")).toBe("completions");
		expect(detectPrivacyProtocol("/v1/embeddings")).toBe("embeddings");
		expect(detectPrivacyProtocol("/v1/images/generations")).toBe("skip");
	});
});

describe("maskRequestBody", () => {
	it("Chat：正文、工具参数与工具描述脱敏，结构不动", () => {
		const context = makeContext();
		const body: Record<string, unknown> = {
			model: "gpt-test",
			messages: [
				{ role: "user", content: `mail ${EMAIL}` },
				{
					role: "assistant",
					content: null,
					tool_calls: [{ id: "call_1", type: "function", function: { name: "shell", arguments: JSON.stringify({ key: API_KEY }) } }],
				},
				{ role: "tool", content: `output ${EMAIL}` },
			],
			tools: [{ type: "function", function: { name: "shell", description: `uses ${API_KEY}`, parameters: { type: "object" } } }],
		};
		maskRequestBody(body, context, "chat");
		const messages = body["messages"] as Array<Record<string, unknown>>;
		expect(messages[0]?.["content"]).not.toContain(EMAIL);
		const calls = messages[1]?.["tool_calls"] as Array<{ function: { arguments: string } }>;
		expect(calls[0]?.function.arguments).not.toContain(API_KEY);
		expect(() => JSON.parse(calls[0]?.function.arguments ?? "")).not.toThrow();
		const tools = body["tools"] as Array<{ function: { description: string; parameters: unknown } }>;
		expect(tools[0]?.function.description).not.toContain(API_KEY);
		expect(tools[0]?.function.parameters).toEqual({ type: "object" });
	});

	it("Chat：图片块原样保留", () => {
		const context = makeContext();
		const body: Record<string, unknown> = {
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: `see ${EMAIL}` },
						{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
					],
				},
			],
		};
		maskRequestBody(body, context, "chat");
		const messages = body["messages"] as Array<{ content: Array<Record<string, unknown>> }>;
		const parts = messages[0]?.content ?? [];
		expect(parts[0]?.["text"]).not.toContain(EMAIL);
		expect(parts[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });
	});

	it("Anthropic：system、tool_use.input 与 tool_result 脱敏", () => {
		const context = makeContext();
		const body: Record<string, unknown> = {
			system: [{ type: "text", text: `agent ${EMAIL}` }],
			messages: [
				{
					role: "assistant",
					content: [
						{ type: "tool_use", id: "tu_1", name: "read", input: { path: "/Users/jansen/a.ts", note: EMAIL } },
					],
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "tu_1", content: `file has ${API_KEY}` }],
				},
			],
			tools: [{ name: "read", description: `reads ${API_KEY}`, input_schema: { type: "object" } }],
		};
		maskRequestBody(body, context, "anthropic");
		const system = body["system"] as Array<{ text: string }>;
		expect(system[0]?.text).not.toContain(EMAIL);
		const messages = body["messages"] as Array<{ content: Array<Record<string, unknown>> }>;
		const toolUse = messages[0]?.content[0] as { input: Record<string, unknown> };
		expect(JSON.stringify(toolUse.input)).not.toContain(EMAIL);
		expect(String(toolUse.input["path"])).not.toContain("jansen");
		const toolResult = messages[1]?.content[0] as { content: string };
		expect(toolResult.content).not.toContain(API_KEY);
	});

	it("Anthropic：带签名的 thinking 不动，未签名的脱敏", () => {
		const context = makeContext();
		const body: Record<string, unknown> = {
			messages: [
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: `signed ${API_KEY}`, signature: "sig-abc" },
						{ type: "thinking", thinking: `unsigned ${API_KEY}` },
						{ type: "redacted_thinking", data: "whatever" },
					],
				},
			],
		};
		maskRequestBody(body, context, "anthropic");
		const messages = body["messages"] as Array<{ content: Array<Record<string, unknown>> }>;
		const blocks = messages[0]?.content ?? [];
		expect(blocks[0]?.["thinking"]).toBe(`signed ${API_KEY}`);
		expect(blocks[1]?.["thinking"]).not.toContain(API_KEY);
		expect(blocks[2]).toEqual({ type: "redacted_thinking", data: "whatever" });
	});

	it("Anthropic：图片与文档块原样保留", () => {
		const context = makeContext();
		const media = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } };
		const body: Record<string, unknown> = { messages: [{ role: "user", content: [media] }] };
		maskRequestBody(body, context, "anthropic");
		const messages = body["messages"] as Array<{ content: unknown[] }>;
		expect(messages[0]?.content[0]).toEqual(media);
	});

	it("Responses：instructions、function_call 参数与 reasoning 摘要脱敏", () => {
		const context = makeContext();
		const body: Record<string, unknown> = {
			instructions: `system ${EMAIL}`,
			input: [
				{ type: "message", role: "user", content: [{ type: "input_text", text: `hi ${EMAIL}` }] },
				{ type: "function_call", call_id: "call_1", name: "shell", arguments: JSON.stringify({ key: API_KEY }) },
				{ type: "function_call_output", call_id: "call_1", output: `stdout ${EMAIL}` },
				{ type: "reasoning", summary: [{ type: "summary_text", text: `thought ${API_KEY}` }], encrypted_content: `enc-${API_KEY}` },
			],
		};
		maskRequestBody(body, context, "responses");
		expect(String(body["instructions"])).not.toContain(EMAIL);
		const input = body["input"] as Array<Record<string, unknown>>;
		expect(JSON.stringify(input[0])).not.toContain(EMAIL);
		expect(String(input[1]?.["arguments"])).not.toContain(API_KEY);
		expect(String(input[2]?.["output"])).not.toContain(EMAIL);
		expect(JSON.stringify(input[3]?.["summary"])).not.toContain(API_KEY);
		expect(input[3]?.["encrypted_content"]).toBe(`enc-${API_KEY}`);
	});

	it("Completions：字符串与数组 prompt 都脱敏", () => {
		const context = makeContext();
		const body: Record<string, unknown> = { prompt: [`mail ${EMAIL}`, [1, 2, 3]] };
		maskRequestBody(body, context, "completions");
		const prompt = body["prompt"] as unknown[];
		expect(String(prompt[0])).not.toContain(EMAIL);
		expect(prompt[1]).toEqual([1, 2, 3]);
	});

	it("Embeddings：字符串输入脱敏", () => {
		const context = makeContext();
		const body: Record<string, unknown> = { input: [`mail ${EMAIL}`, 42] };
		maskRequestBody(body, context, "embeddings");
		const input = body["input"] as unknown[];
		expect(String(input[0])).not.toContain(EMAIL);
		expect(input[1]).toBe(42);
	});
});
