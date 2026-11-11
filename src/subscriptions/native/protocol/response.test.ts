/**
 * 响应协议转换的跨协议矩阵测试。
 */

import type { SubscriptionInboundProtocol, SubscriptionWireProtocol } from "../types";
import { translateResponse } from "./types";

/**
 * 用固定模型映射执行响应翻译。
 * @param inbound - 入口协议
 * @param upstream - 上游协议
 * @param body - 上游响应体
 */
function translate(
	inbound: SubscriptionInboundProtocol,
	upstream: SubscriptionWireProtocol,
	body: Record<string, unknown>,
): Record<string, unknown> {
	return translateResponse(inbound, upstream, body, {
		model: "client-model",
		upstreamModel: "upstream-model",
	});
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

/**
 * 读取对象字段。
 * @param body - 响应体
 * @param key - 字段名
 */
function recordAt(body: Record<string, unknown>, key: string): Record<string, unknown> {
	const value = body[key];
	return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

describe("translateResponse", () => {
	it("chat 入口 ← messages 上游：思考、工具与缓存用量", () => {
		const out = translate("chat", "messages", {
			id: "msg_1",
			type: "message",
			role: "assistant",
			model: "upstream-model",
			content: [
				{ type: "thinking", thinking: "plan", signature: "sig" },
				{ type: "text", text: "hello" },
				{ type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "x" } },
			],
			stop_reason: "tool_use",
			stop_sequence: null,
			usage: {
				input_tokens: 10,
				output_tokens: 5,
				cache_read_input_tokens: 2,
				cache_creation_input_tokens: 1,
			},
		});
		expect(out).toMatchObject({
			id: "msg_1",
			object: "chat.completion",
			model: "client-model",
		});
		expect(out["created"]).toEqual(expect.any(Number));
		const message = recordAt(itemsAt(out, "choices")[0] ?? {}, "message");
		expect(message).toMatchObject({ role: "assistant", content: "hello", reasoning_content: "plan" });
		expect(message["tool_calls"]).toEqual([
			{ id: "toolu_1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } },
		]);
		expect(itemsAt(out, "choices")[0]?.["finish_reason"]).toBe("tool_calls");
		expect(out["usage"]).toEqual({
			prompt_tokens: 13,
			completion_tokens: 5,
			total_tokens: 18,
			prompt_tokens_details: { cached_tokens: 2 },
		});
	});

	it("chat 入口 ← responses 上游：输出项与用量明细", () => {
		const out = translate("chat", "responses", {
			id: "resp_1",
			object: "response",
			created_at: 100,
			status: "completed",
			model: "upstream-model",
			output: [
				{ type: "reasoning", id: "r1", summary: [{ type: "summary_text", text: "plan" }] },
				{ type: "message", id: "m1", role: "assistant", content: [{ type: "output_text", text: "hi" }] },
				{ type: "function_call", id: "f1", call_id: "call_1", name: "lookup", arguments: '{"q":"x"}' },
			],
			usage: {
				input_tokens: 7,
				input_tokens_details: { cached_tokens: 1 },
				output_tokens: 3,
				output_tokens_details: { reasoning_tokens: 2 },
				total_tokens: 10,
			},
		});
		expect(out["id"]).toBe("resp_1");
		expect(out["created"]).toBe(100);
		expect(out["model"]).toBe("client-model");
		const message = recordAt(itemsAt(out, "choices")[0] ?? {}, "message");
		expect(message).toMatchObject({ content: "hi", reasoning_content: "plan" });
		expect(itemsAt(out, "choices")[0]?.["finish_reason"]).toBe("tool_calls");
		expect(out["usage"]).toEqual({
			prompt_tokens: 7,
			completion_tokens: 3,
			total_tokens: 10,
			prompt_tokens_details: { cached_tokens: 1 },
			completion_tokens_details: { reasoning_tokens: 2 },
		});
	});

	it("chat 入口 ← gemini 上游：思考文本与函数调用", () => {
		const out = translate("chat", "gemini", {
			responseId: "g1",
			modelVersion: "gemini-x",
			candidates: [
				{
					content: {
						role: "model",
						parts: [
							{ text: "plan", thought: true },
							{ text: "hi" },
							{ functionCall: { name: "lookup", args: { q: "x" } } },
						],
					},
					finishReason: "STOP",
				},
			],
			usageMetadata: {
				promptTokenCount: 4,
				candidatesTokenCount: 2,
				totalTokenCount: 7,
				thoughtsTokenCount: 1,
			},
		});
		expect(out["id"]).toBe("g1");
		expect(out["model"]).toBe("client-model");
		const message = recordAt(itemsAt(out, "choices")[0] ?? {}, "message");
		expect(message).toMatchObject({ content: "hi", reasoning_content: "plan" });
		const toolCalls = itemsAt(message, "tool_calls");
		expect(toolCalls[0]).toMatchObject({ type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } });
		expect(itemsAt(out, "choices")[0]?.["finish_reason"]).toBe("tool_calls");
		expect(out["usage"]).toMatchObject({
			prompt_tokens: 4,
			completion_tokens: 3,
			total_tokens: 7,
			completion_tokens_details: { reasoning_tokens: 1 },
		});
	});

	it("messages 入口 ← chat 上游：长度截断优先于工具调用", () => {
		const out = translate("messages", "chat", {
			id: "chatcmpl-1",
			object: "chat.completion",
			created: 100,
			model: "upstream-model",
			choices: [
				{
					index: 0,
					message: {
						role: "assistant",
						content: "hi",
						reasoning_content: "plan",
						tool_calls: [
							{ id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } },
						],
					},
					finish_reason: "length",
				},
			],
			usage: {
				prompt_tokens: 4,
				completion_tokens: 2,
				total_tokens: 6,
				prompt_tokens_details: { cached_tokens: 1 },
			},
		});
		expect(out["id"]).toBe("msg_chatcmpl-1");
		expect(out["type"]).toBe("message");
		expect(out["role"]).toBe("assistant");
		expect(out["model"]).toBe("client-model");
		const content = itemsAt(out, "content");
		expect(content[0]).toEqual({ type: "thinking", thinking: "plan" });
		expect(content[1]).toEqual({ type: "text", text: "hi" });
		expect(content[2]).toMatchObject({ type: "tool_use", id: "call_1", name: "lookup", input: { q: "x" } });
		expect(out["stop_reason"]).toBe("max_tokens");
		expect(out["usage"]).toEqual({
			input_tokens: 3,
			output_tokens: 2,
			cache_read_input_tokens: 1,
		});
	});

	it("messages 入口 ← responses 上游：incomplete 转为 max_tokens", () => {
		const out = translate("messages", "responses", {
			id: "resp_1",
			object: "response",
			created_at: 100,
			status: "incomplete",
			model: "upstream-model",
			output: [
				{ type: "reasoning", id: "r1", summary: [{ type: "summary_text", text: "plan" }], encrypted_content: "enc" },
				{ type: "message", id: "m1", role: "assistant", content: [{ type: "output_text", text: "hi" }] },
				{ type: "function_call", id: "f1", call_id: "call_1", name: "lookup", arguments: '{"q":"x"}' },
			],
			usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
		});
		expect(out["id"]).toBe("msg_resp_1");
		expect(out["model"]).toBe("client-model");
		const content = itemsAt(out, "content");
		expect(content[0]).toEqual({ type: "thinking", thinking: "plan", signature: "enc" });
		expect(content[1]).toEqual({ type: "text", text: "hi" });
		expect(content[2]).toMatchObject({ type: "tool_use", id: "call_1", name: "lookup" });
		expect(out["stop_reason"]).toBe("max_tokens");
		expect(out["usage"]).toEqual({ input_tokens: 7, output_tokens: 3 });
	});

	it("messages 入口 ← gemini 上游：函数响应转为 tool_use", () => {
		const out = translate("messages", "gemini", {
			responseId: "g1",
			modelVersion: "gemini-x",
			candidates: [
				{
					content: { role: "model", parts: [{ text: "hi" }, { functionCall: { name: "lookup", args: { q: "x" } } }] },
					finishReason: "STOP",
				},
			],
			usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, totalTokenCount: 6 },
		});
		expect(out["id"]).toBe("msg_g1");
		const content = itemsAt(out, "content");
		expect(content[0]).toEqual({ type: "text", text: "hi" });
		expect(content[1]).toMatchObject({ type: "tool_use", name: "lookup", input: { q: "x" } });
		expect(out["stop_reason"]).toBe("tool_use");
		expect(out["usage"]).toEqual({ input_tokens: 4, output_tokens: 2 });
	});

	it("responses 入口 ← chat 上游：输出项、状态与用量", () => {
		const out = translate("responses", "chat", {
			id: "chatcmpl-1",
			object: "chat.completion",
			created: 100,
			model: "upstream-model",
			choices: [
				{
					index: 0,
					message: {
						role: "assistant",
						content: "hi",
						tool_calls: [
							{ id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } },
						],
					},
					finish_reason: "tool_calls",
				},
			],
			usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
		});
		expect(out).toMatchObject({
			id: "resp_1",
			object: "response",
			status: "completed",
			error: null,
			model: "client-model",
		});
		expect(out["created_at"]).toBe(100);
		const output = itemsAt(out, "output");
		expect(output.map((item) => item["type"])).toEqual(["message", "function_call"]);
		expect(itemsAt(output[0] ?? {}, "content")[0]).toEqual({
			type: "output_text",
			annotations: [],
			logprobs: [],
			text: "hi",
		});
		expect(output[1]).toMatchObject({ call_id: "call_1", name: "lookup", arguments: '{"q":"x"}' });
		expect(out["usage"]).toEqual({
			input_tokens: 4,
			input_tokens_details: { cached_tokens: 0 },
			output_tokens: 2,
			output_tokens_details: { reasoning_tokens: 0 },
			total_tokens: 6,
		});
	});

	it("responses 入口 ← messages 上游：签名思考转为 reasoning 项", () => {
		const out = translate("responses", "messages", {
			id: "msg_1",
			type: "message",
			role: "assistant",
			model: "upstream-model",
			content: [
				{ type: "thinking", thinking: "plan", signature: "sig" },
				{ type: "text", text: "hi" },
				{ type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "x" } },
			],
			stop_reason: "max_tokens",
			usage: { input_tokens: 7, output_tokens: 3 },
		});
		expect(out["id"]).toBe("resp_msg_1");
		expect(out["status"]).toBe("incomplete");
		expect(out["incomplete_details"]).toEqual({ reason: "max_output_tokens" });
		const output = itemsAt(out, "output");
		expect(output.map((item) => item["type"])).toEqual(["reasoning", "message", "function_call"]);
		expect(output[0]).toMatchObject({
			summary: [{ type: "summary_text", text: "plan" }],
			encrypted_content: "sig",
		});
		expect(itemsAt(output[1] ?? {}, "content")[0]).toMatchObject({ type: "output_text", text: "hi" });
		expect(output[2]).toMatchObject({ call_id: "toolu_1", name: "lookup", arguments: '{"q":"x"}' });
		expect(out["usage"]).toMatchObject({ input_tokens: 7, output_tokens: 3, total_tokens: 10 });
	});

	it("responses 入口 ← gemini 上游：安全拦截转为 content_filter", () => {
		const out = translate("responses", "gemini", {
			responseId: "g1",
			modelVersion: "gemini-x",
			candidates: [{ content: { role: "model", parts: [{ text: "partial" }] }, finishReason: "SAFETY" }],
			usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1, totalTokenCount: 5 },
		});
		expect(out["status"]).toBe("incomplete");
		expect(out["incomplete_details"]).toEqual({ reason: "content_filter" });
		const output = itemsAt(out, "output");
		expect(output[0]?.["type"]).toBe("message");
		expect(out["usage"]).toMatchObject({ input_tokens: 4, output_tokens: 1, total_tokens: 5 });
	});

	it("错误载荷按入口协议翻译", () => {
		const chatError = translate("chat", "messages", {
			type: "error",
			error: { type: "authentication_error", message: "bad key" },
		});
		expect(chatError).toEqual({
			error: { message: "bad key", type: "authentication_error", param: null, code: null },
		});
		const messagesError = translate("messages", "responses", {
			error: { code: "rate_limit_exceeded", message: "slow down" },
		});
		expect(messagesError).toEqual({
			type: "error",
			error: { type: "rate_limit_exceeded", message: "slow down" },
		});
		const responsesError = translate("responses", "gemini", {
			error: { code: 429, message: "quota", status: "RESOURCE_EXHAUSTED" },
		});
		expect(responsesError).toEqual({
			error: { code: "RESOURCE_EXHAUSTED", message: "quota", param: null },
		});
		const messagesGeminiError = translate("messages", "gemini", {
			error: { code: 429, message: "quota", status: "RESOURCE_EXHAUSTED" },
		});
		expect(messagesGeminiError).toEqual({
			type: "error",
			error: { type: "rate_limit_error", message: "quota" },
		});
	});

	it("gemini 入口 ← chat 上游生成 candidates 与 usageMetadata", () => {
		const gemini = translate("gemini", "chat", {
			id: "chatcmpl-1",
			object: "chat.completion",
			model: "upstream-model",
			choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
		});
		const candidates = itemsAt(gemini, "candidates");
		expect(candidates).toHaveLength(1);
		const candidate = candidates[0];
		if (!candidate) {
			throw new Error("缺少 Gemini candidate");
		}
		expect(recordAt(candidate, "content")["parts"]).toEqual([{ text: "hello" }]);
		expect(candidate["finishReason"]).toBe("STOP");
		expect(recordAt(gemini, "usageMetadata")["totalTokenCount"]).toBe(5);
	});

	it("同协议保留未知字段并只替换模型", () => {
		const chat = translate("chat", "chat", {
			id: "chatcmpl-1",
			object: "chat.completion",
			model: "upstream-model",
			choices: [],
			extra: 1,
		});
		expect(chat).toEqual({
			id: "chatcmpl-1",
			object: "chat.completion",
			model: "client-model",
			choices: [],
			extra: 1,
		});
		const messages = translate("messages", "messages", {
			id: "msg_1",
			type: "message",
			model: "upstream-model",
			content: [],
			extra: 1,
		});
		expect(messages).toEqual({
			id: "msg_1",
			type: "message",
			model: "client-model",
			content: [],
			extra: 1,
		});
		const responses = translate("responses", "responses", {
			id: "resp_1",
			object: "response",
			model: "upstream-model",
			output: [],
			extra: 1,
		});
		expect(responses).toEqual({
			id: "resp_1",
			object: "response",
			model: "client-model",
			output: [],
			extra: 1,
		});
	});
});
