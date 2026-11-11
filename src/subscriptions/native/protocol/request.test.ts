/**
 * 请求协议转换的跨协议矩阵测试。
 */

import type { SubscriptionInboundProtocol, SubscriptionWireProtocol } from "../types";
import { translateRequest } from "./types";

/**
 * 用固定模型映射执行请求翻译。
 * @param inbound - 入口协议
 * @param upstream - 上游协议
 * @param body - 入口请求体
 */
function translate(
	inbound: SubscriptionInboundProtocol,
	upstream: SubscriptionWireProtocol,
	body: Record<string, unknown>,
): Record<string, unknown> {
	return translateRequest(inbound, upstream, body, {
		model: "client-model",
		upstreamModel: "upstream-model",
	});
}

/**
 * 把未知值读取为对象。
 * @param value - 任意值
 */
function asObject(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * 读取对象数组字段。
 * @param body - 响应体
 * @param key - 字段名
 */
function itemsAt(body: Record<string, unknown>, key: string): Record<string, unknown>[] {
	const value = body[key];
	return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

describe("translateRequest", () => {
	it("chat → responses 保留系统提示、工具、图片与思考", () => {
		const out = translate("chat", "responses", {
			model: "client-model",
			messages: [
				{ role: "system", content: "be nice" },
				{
					role: "user",
					content: [
						{ type: "text", text: "hi" },
						{ type: "image_url", image_url: { url: "data:image/png;base64,AAA", detail: "high" } },
					],
				},
				{
					role: "assistant",
					content: "checking",
					reasoning_content: "plan",
					tool_calls: [
						{ id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } },
					],
				},
				{ role: "tool", tool_call_id: "call_1", content: "result" },
			],
			tools: [
				{
					type: "function",
					function: { name: "lookup", description: "d", parameters: { type: "object" } },
				},
			],
			tool_choice: "required",
			max_tokens: 123,
			temperature: 0.2,
			top_p: 0.9,
			stop: ["END"],
			stream: true,
			user: "u1",
			response_format: {
				type: "json_schema",
				json_schema: { name: "out", schema: { type: "object" }, strict: true },
			},
		});
		expect(out["model"]).toBe("upstream-model");
		expect(out["instructions"]).toBe("be nice");
		expect(out["max_output_tokens"]).toBe(123);
		expect(out["temperature"]).toBe(0.2);
		expect(out["top_p"]).toBe(0.9);
		expect(out["tool_choice"]).toBe("required");
		expect(out["stream"]).toBe(true);
		expect(out["user"]).toBe("u1");
		const input = itemsAt(out, "input");
		expect(input.map((item) => item["type"])).toEqual([
			"message",
			"reasoning",
			"message",
			"function_call",
			"function_call_output",
		]);
		expect(input[0]?.["role"]).toBe("user");
		expect(itemsAt(input[0] ?? {}, "content").map((part) => part["type"])).toEqual([
			"input_text",
			"input_image",
		]);
		expect(input[1]?.["summary"]).toEqual([{ type: "summary_text", text: "plan" }]);
		expect(input[3]?.["call_id"]).toBe("call_1");
		expect(input[3]?.["name"]).toBe("lookup");
		expect(input[4]?.["output"]).toBe("result");
		const tools = itemsAt(out, "tools");
		expect(tools[0]).toMatchObject({ type: "function", name: "lookup" });
		expect(out["text"]).toMatchObject({
			format: { type: "json_schema", name: "out", schema: { type: "object" }, strict: true },
		});
	});

	it("messages → responses 保留签名思考与工具配对", () => {
		const out = translate("messages", "responses", {
			model: "client-model",
			system: [{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }],
			messages: [
				{ role: "user", content: [{ type: "text", text: "hi" }] },
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "plan", signature: "sig" },
						{ type: "text", text: "checking" },
						{ type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "x" } },
					],
				},
				{
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "toolu_1", content: "result" },
						{ type: "text", text: "thanks" },
					],
				},
			],
			tools: [{ name: "lookup", description: "d", input_schema: { type: "object" } }],
			tool_choice: { type: "any" },
			max_tokens: 200,
			stop_sequences: ["END"],
			temperature: 0.3,
			thinking: { type: "enabled", budget_tokens: 2048 },
			metadata: { user_id: "u2" },
			stream: true,
		});
		expect(out["instructions"]).toBe("sys");
		expect(out["max_output_tokens"]).toBe(200);
		expect(out["tool_choice"]).toBe("required");
		expect(out["stream"]).toBe(true);
		expect(out["metadata"]).toEqual({ user_id: "u2" });
		expect(out["reasoning"]).toEqual({ effort: "low" });
		const input = itemsAt(out, "input");
		expect(input.map((item) => item["type"])).toEqual([
			"message",
			"reasoning",
			"message",
			"function_call",
			"function_call_output",
			"message",
		]);
		expect(input[1]).toMatchObject({
			type: "reasoning",
			encrypted_content: "sig",
			summary: [{ type: "summary_text", text: "plan" }],
		});
		expect(input[3]).toMatchObject({ type: "function_call", call_id: "toolu_1", name: "lookup" });
		expect(input[4]).toMatchObject({ type: "function_call_output", call_id: "toolu_1", output: "result" });
		expect(itemsAt(out, "tools")[0]).toMatchObject({
			type: "function",
			name: "lookup",
			description: "d",
			parameters: { type: "object" },
		});
	});

	it("responses → chat 还原工具调用与输入项", () => {
		const out = translate("responses", "chat", {
			model: "client-model",
			instructions: "sys",
			input: [
				{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
				{ type: "reasoning", summary: [{ type: "summary_text", text: "plan" }], encrypted_content: "enc" },
				{ type: "message", role: "assistant", content: [{ type: "output_text", text: "checking" }] },
				{ type: "function_call", call_id: "call_1", name: "lookup", arguments: '{"q":"x"}' },
				{ type: "function_call_output", call_id: "call_1", output: "result" },
			],
			tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }],
			tool_choice: { type: "function", name: "lookup" },
			max_output_tokens: 99,
			temperature: 0.4,
			top_p: 0.8,
			text: { format: { type: "json_object" } },
			user: "u3",
			parallel_tool_calls: false,
			stream: false,
		});
		expect(out["model"]).toBe("upstream-model");
		expect(out["max_tokens"]).toBe(99);
		expect(out["temperature"]).toBe(0.4);
		expect(out["top_p"]).toBe(0.8);
		expect(out["user"]).toBe("u3");
		expect(out["parallel_tool_calls"]).toBe(false);
		expect(out["response_format"]).toEqual({ type: "json_object" });
		expect(out["tool_choice"]).toEqual({ type: "function", function: { name: "lookup" } });
		const messages = itemsAt(out, "messages");
		expect(messages[0]).toMatchObject({ role: "system", content: "sys" });
		expect(messages[1]).toMatchObject({ role: "user", content: "hi" });
		expect(messages[2]).toMatchObject({ role: "assistant", content: "checking", reasoning_content: "plan" });
		expect(messages[3]).toMatchObject({
			role: "assistant",
			tool_calls: [
				{ id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } },
			],
		});
		expect(messages[4]).toMatchObject({ role: "tool", tool_call_id: "call_1", content: "result" });
	});

	it("responses → messages 生成 system 数组与结构化输出提示", () => {
		const out = translate("responses", "messages", {
			model: "client-model",
			instructions: [
				{ type: "input_text", text: "a" },
				{ type: "input_text", text: "b" },
			],
			input: [
				{
					type: "message",
					role: "user",
					content: [
						{ type: "input_text", text: "hi" },
						{ type: "input_image", image_url: "data:image/png;base64,AAA" },
					],
				},
				{ type: "function_call", call_id: "call_1", name: "lookup", arguments: '{"q":"x"}' },
				{ type: "function_call_output", call_id: "call_1", output: "result" },
			],
			tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }],
			tool_choice: "required",
			max_output_tokens: 77,
			text: { format: { type: "json_schema", name: "out", schema: { type: "object" } } },
		});
		expect(out["model"]).toBe("upstream-model");
		expect(out["max_tokens"]).toBe(77);
		expect(out["tool_choice"]).toEqual({ type: "any" });
		const system = itemsAt(out, "system");
		expect(system[0]).toMatchObject({ type: "text", text: "a" });
		expect(system[1]).toMatchObject({ type: "text", text: "b" });
		expect(system[2]?.["text"]).toContain("JSON schema");
		const messages = itemsAt(out, "messages");
		expect(itemsAt(messages[0] ?? {}, "content").map((block) => block["type"])).toEqual([
			"text",
			"image",
		]);
		const assistant = itemsAt(messages[1] ?? {}, "content");
		expect(assistant[0]).toMatchObject({ type: "tool_use", id: "call_1", name: "lookup", input: { q: "x" } });
		const toolResult = itemsAt(messages[2] ?? {}, "content");
		expect(toolResult[0]).toMatchObject({ type: "tool_result", tool_use_id: "call_1", content: "result" });
	});

	it("messages → chat 还原思考与工具结果", () => {
		const out = translate("messages", "chat", {
			model: "client-model",
			system: "sys",
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "hi" },
						{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
					],
				},
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "plan", signature: "sig" },
						{ type: "text", text: "checking" },
						{ type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "x" } },
					],
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "result" }],
				},
			],
			tools: [{ name: "lookup", input_schema: { type: "object" } }],
			tool_choice: { type: "tool", name: "lookup" },
			max_tokens: 100,
			temperature: 0.5,
			top_p: 0.6,
			stop_sequences: ["END"],
			metadata: { user_id: "u4" },
		});
		expect(out["max_tokens"]).toBe(100);
		expect(out["temperature"]).toBe(0.5);
		expect(out["top_p"]).toBe(0.6);
		expect(out["stop"]).toEqual(["END"]);
		expect(out["user"]).toBe("u4");
		expect(out["tool_choice"]).toEqual({ type: "function", function: { name: "lookup" } });
		const messages = itemsAt(out, "messages");
		expect(messages[0]).toMatchObject({ role: "system", content: "sys" });
		expect(itemsAt(messages[1] ?? {}, "content").map((part) => part["type"])).toEqual([
			"text",
			"image_url",
		]);
		expect(messages[2]).toMatchObject({
			role: "assistant",
			content: "checking",
			reasoning_content: "plan",
			tool_calls: [{ id: "toolu_1", type: "function", function: { name: "lookup" } }],
		});
		expect(messages[3]).toMatchObject({ role: "tool", tool_call_id: "toolu_1", content: "result" });
	});

	it("chat → messages 补齐默认 max_tokens 并转换思考预算", () => {
		const out = translate("chat", "messages", {
			model: "client-model",
			messages: [
				{ role: "system", content: "sys" },
				{
					role: "user",
					content: [
						{ type: "text", text: "hi" },
						{ type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
					],
				},
				{
					role: "assistant",
					content: "checking",
					tool_calls: [
						{ id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } },
					],
				},
				{ role: "tool", tool_call_id: "call_1", content: "result" },
			],
			tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
			tool_choice: "required",
			stop: ["END"],
			reasoning_effort: "high",
			response_format: {
				type: "json_schema",
				json_schema: { name: "out", schema: { type: "object" } },
			},
		});
		expect(out["max_tokens"]).toBe(32000);
		expect(out["thinking"]).toEqual({ type: "enabled", budget_tokens: 16384 });
		expect(out["temperature"]).toBeUndefined();
		expect(out["stop_sequences"]).toEqual(["END"]);
		expect(out["tool_choice"]).toEqual({ type: "any" });
		const system = itemsAt(out, "system");
		expect(system[0]).toMatchObject({ type: "text", text: "sys" });
		expect(system.at(-1)?.["text"]).toContain("JSON schema");
		const messages = itemsAt(out, "messages");
		expect(itemsAt(messages[0] ?? {}, "content").map((block) => block["type"])).toEqual([
			"text",
			"image",
		]);
		const assistant = itemsAt(messages[1] ?? {}, "content");
		expect(assistant[0]).toMatchObject({ type: "text", text: "checking" });
		expect(assistant[1]).toMatchObject({ type: "tool_use", id: "call_1", name: "lookup" });
	});

	it("chat → gemini 生成 contents、tools 与 generationConfig", () => {
		const out = translate("chat", "gemini", {
			model: "client-model",
			messages: [
				{ role: "system", content: "sys" },
				{
					role: "user",
					content: [
						{ type: "text", text: "hi" },
						{ type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
					],
				},
				{
					role: "assistant",
					content: "checking",
					tool_calls: [
						{ id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } },
					],
				},
				{ role: "tool", tool_call_id: "call_1", content: "result" },
			],
			tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
			tool_choice: "required",
			max_tokens: 123,
			temperature: 0.2,
			top_p: 0.9,
			top_k: 5,
			stop: ["END"],
			reasoning_effort: "medium",
			response_format: { type: "json_object" },
		});
		expect(out["model"]).toBe("upstream-model");
		expect(out["systemInstruction"]).toEqual({ parts: [{ text: "sys" }] });
		const contents = itemsAt(out, "contents");
		expect(contents.map((content) => content["role"])).toEqual(["user", "model", "user"]);
		const parts = (content: Record<string, unknown>): Record<string, unknown>[] =>
			itemsAt(content, "parts");
		expect(parts(contents[0] ?? {})[0]).toEqual({ text: "hi" });
		expect(parts(contents[0] ?? {})[1]).toMatchObject({
			inlineData: { mimeType: "image/png", data: "AAA" },
		});
		expect(parts(contents[1] ?? {})[0]).toEqual({ text: "checking" });
		expect(parts(contents[1] ?? {})[1]).toMatchObject({ functionCall: { name: "lookup", args: { q: "x" } } });
		expect(parts(contents[2] ?? {})[0]).toMatchObject({
			functionResponse: { name: "lookup", response: { result: "result" } },
		});
		const tools = itemsAt(out, "tools");
		expect(tools[0]).toMatchObject({ functionDeclarations: [{ name: "lookup" }] });
		expect(out["toolConfig"]).toEqual({ functionCallingConfig: { mode: "ANY" } });
		expect(out["generationConfig"]).toMatchObject({
			maxOutputTokens: 123,
			temperature: 0.2,
			topP: 0.9,
			topK: 5,
			stopSequences: ["END"],
			responseMimeType: "application/json",
			thinkingConfig: { thinkingBudget: 8192, includeThoughts: true },
		});
	});

	it("messages → gemini 保留签名思考与 allowedFunctionNames", () => {
		const out = translate("messages", "gemini", {
			model: "client-model",
			system: "sys",
			messages: [
				{ role: "user", content: [{ type: "text", text: "hi" }] },
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "plan", signature: "sig" },
						{ type: "text", text: "checking" },
						{ type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "x" } },
					],
				},
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "result" }] },
			],
			tools: [{ name: "lookup", input_schema: { type: "object" } }],
			tool_choice: { type: "tool", name: "lookup" },
			max_tokens: 64,
			thinking: { type: "enabled", budget_tokens: 2048 },
		});
		expect(out["systemInstruction"]).toEqual({ parts: [{ text: "sys" }] });
		const contents = itemsAt(out, "contents");
		const modelParts = itemsAt(contents[1] ?? {}, "parts");
		expect(modelParts[0]).toEqual({ text: "plan", thought: true, thoughtSignature: "sig" });
		expect(modelParts[1]).toEqual({ text: "checking" });
		expect(modelParts[2]).toMatchObject({ functionCall: { name: "lookup" } });
		expect(out["toolConfig"]).toEqual({
			functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["lookup"] },
		});
		expect(out["generationConfig"]).toMatchObject({
			maxOutputTokens: 64,
			thinkingConfig: { thinkingBudget: 2048, includeThoughts: true },
		});
	});

	it("chat → gemini 保留 $ref/$defs，交给目标清洗层处理", () => {
		const out = translate("chat", "gemini", {
			model: "client-model",
			messages: [{ role: "user", content: "hi" }],
			tools: [
				{
					type: "function",
					function: {
						name: "lookup",
						parameters: {
							type: "object",
							properties: { item: { $ref: "#/$defs/Item" } },
							$defs: { Item: { type: "object", properties: { name: { type: "string" } } } },
						},
					},
				},
			],
		});
		const tools = itemsAt(out, "tools");
		const declaration = itemsAt(tools[0] ?? {}, "functionDeclarations")[0];
		expect(JSON.stringify(declaration?.["parameters"])).toContain("$ref");
		expect(JSON.stringify(declaration?.["parameters"])).toContain("$defs");
	});

	it("messages → gemini 工具结果携带 id、签名与图片", () => {
		const out = translate("messages", "gemini", {
			model: "client-model",
			messages: [
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "x" } }],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_1",
							content: [
								{ type: "text", text: "ok" },
								{ type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
							],
						},
					],
				},
			],
			tools: [{ name: "lookup", input_schema: { type: "object" } }],
			max_tokens: 64,
		});
		const contents = itemsAt(out, "contents");
		const modelPart = itemsAt(contents[0] ?? {}, "parts")[0];
		expect(modelPart?.["functionCall"]).toMatchObject({ id: "toolu_1", name: "lookup" });
		const resultPart = itemsAt(contents[1] ?? {}, "parts")[0];
		expect(resultPart?.["functionResponse"]).toMatchObject({ id: "toolu_1", name: "lookup" });
		const nested = itemsAt(resultPart?.["functionResponse"] as Record<string, unknown>, "parts");
		expect(nested[0]).toEqual({ inlineData: { mimeType: "image/png", data: "QUJD" } });
	});

	it("responses → gemini 将输入项映射为 contents", () => {
		const out = translate("responses", "gemini", {
			model: "client-model",
			instructions: "sys",
			input: [
				{
					type: "message",
					role: "user",
					content: [
						{ type: "input_text", text: "hi" },
						{ type: "input_image", image_url: "data:image/png;base64,AAA" },
					],
				},
				{ type: "reasoning", summary: [{ type: "summary_text", text: "plan" }], encrypted_content: "enc" },
				{ type: "message", role: "assistant", content: [{ type: "output_text", text: "checking" }] },
				{ type: "function_call", call_id: "call_1", name: "lookup", arguments: '{"q":"x"}' },
				{ type: "function_call_output", call_id: "call_1", output: "result" },
			],
			tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }],
			tool_choice: { type: "function", name: "lookup" },
			max_output_tokens: 88,
			reasoning: { effort: "low" },
			text: { format: { type: "json_schema", name: "out", schema: { type: "object" } } },
		});
		expect(out["systemInstruction"]).toEqual({ parts: [{ text: "sys" }] });
		const contents = itemsAt(out, "contents");
		expect(contents.map((content) => content["role"])).toEqual(["user", "model", "user"]);
		const modelParts = itemsAt(contents[1] ?? {}, "parts");
		expect(modelParts[0]).toMatchObject({ text: "plan", thought: true, thoughtSignature: "enc" });
		expect(modelParts[1]).toEqual({ text: "checking" });
		expect(modelParts[2]).toMatchObject({ functionCall: { name: "lookup", args: { q: "x" } } });
		const userParts = itemsAt(contents[2] ?? {}, "parts");
		expect(userParts[0]).toMatchObject({
			functionResponse: { name: "lookup", response: { result: "result" } },
		});
		expect(out["toolConfig"]).toEqual({
			functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["lookup"] },
		});
		expect(out["generationConfig"]).toMatchObject({
			maxOutputTokens: 88,
			responseMimeType: "application/json",
			responseSchema: { type: "object" },
			thinkingConfig: { thinkingBudget: 2048, includeThoughts: true },
		});
	});

	it("messages → chat 把孤立 tool_result 降级为用户文本", () => {
		const out = translate("messages", "chat", {
			model: "client-model",
			max_tokens: 10,
			messages: [
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "missing", content: "ok" }],
				},
			],
		});
		expect(out["messages"]).toEqual([{ role: "user", content: "ok" }]);
	});

	it("responses → chat/gemini 保留 allowed_tools 限制", () => {
		const body = {
			model: "client-model",
			input: "hi",
			tools: [
				{ type: "function", name: "lookup", parameters: { type: "object" } },
				{ type: "function", name: "other", parameters: { type: "object" } },
			],
			tool_choice: {
				type: "allowed_tools",
				allowed_tools: { mode: "auto", tools: [{ type: "function", name: "lookup" }] },
			},
		};
		const chat = translate("responses", "chat", body);
		expect(chat["tool_choice"]).toEqual({
			type: "allowed_tools",
			allowed_tools: { mode: "auto", tools: [{ type: "function", function: { name: "lookup" } }] },
		});
		const gemini = translate("responses", "gemini", body);
		expect(gemini["toolConfig"]).toEqual({ functionCallingConfig: { mode: "AUTO" } });
		const serializedTools = JSON.stringify(gemini["tools"]);
		expect(serializedTools).toContain("lookup");
		expect(serializedTools).not.toContain("other");
	});

	it("gemini 入口 → chat 上游生成 messages 与采样参数", () => {
		const chat = translate("gemini", "chat", {
			contents: [{ role: "user", parts: [{ text: "hi" }] }],
			generationConfig: { maxOutputTokens: 16, temperature: 0.2 },
		});
		expect(chat["messages"]).toEqual([{ role: "user", content: "hi" }]);
		expect(chat["max_tokens"]).toBe(16);
		expect(chat["temperature"]).toBe(0.2);
	});

	it("chat → messages 保留无签名的 thinking 文本", () => {
		const out = translate("chat", "messages", {
			model: "client-model",
			max_tokens: 16,
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "ok", reasoning_content: "plan" },
			],
		});
		const messages = itemsAt(out, "messages");
		const assistant = messages[1] ?? {};
		expect(itemsAt(assistant, "content")).toEqual([
			{ type: "thinking", thinking: "plan" },
			{ type: "text", text: "ok" },
		]);
	});

	it("同协议保留未知字段并只替换模型", () => {
		const chat = translate("chat", "chat", {
			model: "client-model",
			messages: [{ role: "user", content: "hi" }],
			unknown_field: { keep: true },
		});
		expect(chat).toEqual({
			model: "upstream-model",
			messages: [{ role: "user", content: "hi" }],
			unknown_field: { keep: true },
		});
		const messages = translate("messages", "messages", {
			model: "client-model",
			max_tokens: 10,
			messages: [{ role: "user", content: "hi" }],
			extra: 1,
		});
		expect(messages).toEqual({
			model: "upstream-model",
			max_tokens: 10,
			messages: [{ role: "user", content: "hi" }],
			extra: 1,
		});
		const responses = translate("responses", "responses", {
			model: "client-model",
			input: "hi",
			extra: 1,
		});
		expect(responses).toEqual({ model: "upstream-model", input: "hi", extra: 1 });
	});
});
