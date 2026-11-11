/**
 * 流式协议转换的跨协议矩阵测试。
 */

import type { SubscriptionInboundProtocol, SubscriptionWireProtocol } from "../types";
import type { ProtocolEvent } from "./types";
import { createStreamTranslator } from "./types";

/**
 * 用固定模型映射执行流式翻译并在末尾冲刷。
 * @param inbound - 入口协议
 * @param upstream - 上游协议
 * @param events - 上游事件
 */
function run(
	inbound: SubscriptionInboundProtocol,
	upstream: SubscriptionWireProtocol,
	events: ProtocolEvent[],
): ProtocolEvent[] {
	const translator = createStreamTranslator(inbound, upstream, {
		model: "client-model",
		upstreamModel: "upstream-model",
	});
	const outgoing: ProtocolEvent[] = [];
	for (const event of events) {
		outgoing.push(...translator.push(event));
	}
	outgoing.push(...translator.flush());
	return outgoing;
}

/**
 * 把未知值读取为对象。
 * @param value - 任意值
 */
function asObject(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * 读取事件的数据对象。
 * @param event - 协议事件
 */
function dataOf(event: ProtocolEvent | undefined): Record<string, unknown> {
	return event === undefined ? {} : asObject(event.data);
}

/**
 * 读取对象数组字段。
 * @param body - 对象
 * @param key - 字段名
 */
function itemsAt(body: Record<string, unknown>, key: string): Record<string, unknown>[] {
	const value = body[key];
	return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/**
 * 拼接 chat 流中的正文。
 * @param events - 入口事件
 */
function chatContent(events: ProtocolEvent[]): string {
	const texts: string[] = [];
	for (const event of events) {
		for (const choice of itemsAt(dataOf(event), "choices")) {
			const delta = asObject(choice["delta"]);
			if (typeof delta["content"] === "string") {
				texts.push(delta["content"]);
			}
		}
	}
	return texts.join("");
}

/**
 * 在 messages 流中查找指定事件名。
 * @param events - 入口事件
 * @param name - 事件名
 */
function messagesEvent(events: ProtocolEvent[], name: string): Record<string, unknown>[] {
	return events.filter((event) => event.event === name).map(dataOf);
}

describe("createStreamTranslator", () => {
	it("chat 入口 ← messages 上游：文本、工具与用量", () => {
		const out = run("chat", "messages", [
			{
				event: "message_start",
				data: {
					type: "message_start",
					message: { id: "msg_1", model: "upstream-model", usage: { input_tokens: 10, output_tokens: 0 } },
				},
			},
			{ event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
			{ event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } } },
			{ event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } } },
			{ event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
			{
				event: "content_block_start",
				data: {
					type: "content_block_start",
					index: 1,
					content_block: { type: "tool_use", id: "toolu_1", name: "lookup", input: {} },
				},
			},
			{
				event: "content_block_delta",
				data: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"q":"x"}' } },
			},
			{ event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
			{
				event: "message_delta",
				data: {
					type: "message_delta",
					delta: { stop_reason: "tool_use", stop_sequence: null },
					usage: { output_tokens: 5 },
				},
			},
			{ event: "message_stop", data: { type: "message_stop" } },
		]);
		expect(chatContent(out)).toBe("Hello");
		const first = dataOf(out[0]);
		expect(itemsAt(first, "choices")[0]).toMatchObject({ delta: { role: "assistant" } });
		const finishChunk = out.find((event) => {
			const choice = itemsAt(dataOf(event), "choices")[0];
			return choice?.["finish_reason"] !== undefined && choice["finish_reason"] !== null;
		});
		expect(itemsAt(dataOf(finishChunk), "choices")[0]?.["finish_reason"]).toBe("tool_calls");
		const usageChunk = out.find((event) => dataOf(event)["usage"] !== undefined);
		expect(dataOf(usageChunk)["usage"]).toEqual({
			prompt_tokens: 10,
			completion_tokens: 5,
			total_tokens: 15,
		});
		const toolCall = out.flatMap((event) => itemsAt(dataOf(event), "choices")).find(
			(choice) => asObject(choice["delta"])["tool_calls"] !== undefined,
		);
		expect(toolCall?.["delta"]).toMatchObject({
			tool_calls: [{ index: 0, id: "toolu_1", function: { name: "lookup" } }],
		});
		expect(out.at(-1)?.data).toBe("[DONE]");
	});

	it("chat 入口 ← responses 上游：裸 error 事件不会伪装成正常完成", () => {
		const out = run("chat", "responses", [
			{ event: "error", data: { type: "error", error: { type: "invalid_request_error", message: "boom" } } },
		]);
		const error = out.map(dataOf).find((data) => data["error"] !== undefined);
		expect(error?.["error"]).toMatchObject({ message: "boom", type: "invalid_request_error" });
	});

	it("chat 入口 ← responses 上游：只有 output_item.done 时仍保留工具调用", () => {
		const out = run("chat", "responses", [
			{ event: "response.created", data: { type: "response.created", response: { id: "resp_1", model: "m", created_at: 1 } } },
			{
				event: "response.output_item.done",
				data: {
					type: "response.output_item.done",
					output_index: 0,
					item: { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{\"q\":\"x\"}" },
				},
			},
			{
				event: "response.completed",
				data: { type: "response.completed", response: { id: "resp_1", status: "completed", output: [] } },
			},
		]);
		const calls = out
			.flatMap((event) => itemsAt(dataOf(event), "choices"))
			.flatMap((choice) => itemsAt(asObject(choice["delta"]), "tool_calls"));
		const call = calls[0];
		expect(call).toMatchObject({ id: "call_1", function: { name: "lookup" } });
		expect(calls.map((item) => asObject(item["function"])["arguments"]).join("")).toBe("{\"q\":\"x\"}");
	});

	it("chat 入口 ← responses 上游：推理摘要与正文", () => {
		const out = run("chat", "responses", [
			{ event: "response.created", data: { type: "response.created", response: { id: "resp_1", model: "upstream-model", created_at: 100 } } },
			{ event: "response.output_item.added", data: { type: "response.output_item.added", output_index: 0, item: { id: "r1", type: "reasoning", summary: [] } } },
			{ event: "response.reasoning_summary_text.delta", data: { type: "response.reasoning_summary_text.delta", delta: "plan" } },
			{ event: "response.output_item.done", data: { type: "response.output_item.done", output_index: 0, item: { type: "reasoning", summary: [{ type: "summary_text", text: "plan" }] } } },
			{ event: "response.output_item.added", data: { type: "response.output_item.added", output_index: 1, item: { id: "m1", type: "message", content: [] } } },
			{ event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "hi" } },
			{ event: "response.output_item.done", data: { type: "response.output_item.done", output_index: 1, item: { type: "message", content: [{ type: "output_text", text: "hi" }] } } },
			{
				event: "response.completed",
				data: {
					type: "response.completed",
					response: {
						id: "resp_1",
						model: "upstream-model",
						status: "completed",
						usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
					},
				},
			},
		]);
		expect(chatContent(out)).toBe("hi");
		const reasoning = out.flatMap((event) => itemsAt(dataOf(event), "choices")).map((choice) => asObject(choice["delta"])["reasoning_content"]).filter((value) => value !== undefined);
		expect(reasoning).toEqual(["plan"]);
		const usageChunk = out.find((event) => dataOf(event)["usage"] !== undefined);
		expect(dataOf(usageChunk)["usage"]).toMatchObject({ prompt_tokens: 5, completion_tokens: 2 });
		expect(out.at(-1)?.data).toBe("[DONE]");
	});

	it("chat 入口 ← gemini 上游：增量文本与函数调用", () => {
		const out = run("chat", "gemini", [
			{ data: { candidates: [{ content: { role: "model", parts: [{ text: "hi" }] }, index: 0 }] } },
			{
				data: {
					candidates: [
						{
							content: { role: "model", parts: [{ functionCall: { name: "lookup", args: { q: "x" } } }] },
							finishReason: "STOP",
							index: 0,
						},
					],
					usageMetadata: {
						promptTokenCount: 4,
						candidatesTokenCount: 2,
						totalTokenCount: 7,
						thoughtsTokenCount: 1,
					},
				},
			},
		]);
		expect(chatContent(out)).toBe("hi");
		const toolCallDeltas = out
			.flatMap((event) => itemsAt(dataOf(event), "choices"))
			.flatMap((choice) => itemsAt(asObject(choice["delta"]), "tool_calls"));
		const toolCall = toolCallDeltas[0];
		expect(toolCall).toMatchObject({ id: expect.any(String), function: { name: "lookup" } });
		expect(toolCallDeltas.map((call) => asObject(call["function"])["arguments"]).join("")).toBe('{"q":"x"}');
		const finishChunk = out.find((event) => {
			const choice = itemsAt(dataOf(event), "choices")[0];
			return choice?.["finish_reason"] !== undefined && choice["finish_reason"] !== null;
		});
		expect(itemsAt(dataOf(finishChunk), "choices")[0]?.["finish_reason"]).toBe("tool_calls");
		const usageChunk = out.find((event) => dataOf(event)["usage"] !== undefined);
		expect(dataOf(usageChunk)["usage"]).toMatchObject({ prompt_tokens: 4, completion_tokens: 3 });
	});

	it("messages 入口 ← chat 上游：产生完整 Anthropic 事件序列", () => {
		const out = run("messages", "chat", [
			{ data: { id: "chatcmpl-1", model: "upstream-model", created: 100, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] } },
			{ data: { id: "chatcmpl-1", choices: [{ index: 0, delta: { content: "Hel" } }] } },
			{ data: { id: "chatcmpl-1", choices: [{ index: 0, delta: { content: "lo" } }] } },
			{
				data: {
					id: "chatcmpl-1",
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{ index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q"' } },
								],
							},
						},
					],
				},
			},
			{
				data: {
					id: "chatcmpl-1",
					choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ':"x"}' } }] } }],
				},
			},
			{
				data: {
					id: "chatcmpl-1",
					choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
				},
			},
			{
				data: {
					id: "chatcmpl-1",
					choices: [],
					usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
				},
			},
		]);
		const names = out.map((event) => event.event);
		expect(names[0]).toBe("message_start");
		expect(names).toContain("content_block_start");
		expect(names).toContain("message_delta");
		expect(names.at(-1)).toBe("message_stop");
		const messageStart = messagesEvent(out, "message_start")[0];
		expect(messageStart?.["message"]).toMatchObject({ id: "chatcmpl-1", role: "assistant", model: "client-model" });
		const deltas = messagesEvent(out, "content_block_delta");
		const texts = deltas
			.map((data) => data["delta"])
			.filter((delta): delta is Record<string, unknown> => delta !== null && typeof delta === "object")
			.map((delta) => delta["text"])
			.filter((text) => typeof text === "string");
		expect(texts.join("")).toBe("Hello");
		const toolStarts = messagesEvent(out, "content_block_start").filter(
			(data) => asObject(data["content_block"])["type"] === "tool_use",
		);
		expect(toolStarts[0]).toMatchObject({ content_block: { type: "tool_use", id: "call_1", name: "lookup" } });
		const partials = deltas
			.map((data) => data["delta"])
			.filter((delta): delta is Record<string, unknown> => delta !== null && typeof delta === "object")
			.map((delta) => delta["partial_json"])
			.filter((text) => typeof text === "string");
		expect(partials.join("")).toBe('{"q":"x"}');
		const messageDelta = messagesEvent(out, "message_delta")[0];
		expect(messageDelta?.["delta"]).toMatchObject({ stop_reason: "tool_use" });
		expect(messageDelta?.["usage"]).toMatchObject({ input_tokens: 5, output_tokens: 2 });
	});

	it("messages 入口 ← responses 上游：工具参数增量", () => {
		const out = run("messages", "responses", [
			{ event: "response.created", data: { type: "response.created", response: { id: "resp_1", model: "upstream-model", created_at: 100 } } },
			{ event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "hi" } },
			{
				event: "response.output_item.added",
				data: { type: "response.output_item.added", output_index: 1, item: { type: "function_call", call_id: "call_1", name: "lookup", arguments: "" } },
			},
			{
				event: "response.function_call_arguments.delta",
				data: { type: "response.function_call_arguments.delta", output_index: 1, delta: '{"q":"x"}' },
			},
			{
				event: "response.output_item.done",
				data: { type: "response.output_item.done", output_index: 1, item: { type: "function_call", call_id: "call_1", name: "lookup", arguments: '{"q":"x"}' } },
			},
			{
				event: "response.completed",
				data: {
					type: "response.completed",
					response: {
						id: "resp_1",
						status: "completed",
						usage: {
							input_tokens: 5,
							input_tokens_details: { cached_tokens: 1 },
							output_tokens: 2,
							total_tokens: 7,
						},
					},
				},
			},
		]);
		expect(out[0]?.event).toBe("message_start");
		expect(out.at(-1)?.event).toBe("message_stop");
		const messageDelta = messagesEvent(out, "message_delta")[0];
		expect(messageDelta?.["delta"]).toMatchObject({ stop_reason: "tool_use" });
		const toolStart = messagesEvent(out, "content_block_start").find(
			(data) => asObject(data["content_block"])["type"] === "tool_use",
		);
		expect(toolStart?.["content_block"]).toMatchObject({ id: "call_1", name: "lookup" });
		expect(messageDelta?.["usage"]).toMatchObject({
			input_tokens: 4,
			output_tokens: 2,
			cache_read_input_tokens: 1,
		});
	});

	it("messages 入口 ← gemini 上游：函数调用没有参数分片", () => {
		const out = run("messages", "gemini", [
			{
				data: {
					candidates: [
						{
							content: { role: "model", parts: [{ text: "hi" }, { functionCall: { name: "lookup", args: { q: "x" } } }] },
							finishReason: "STOP",
						},
					],
					usageMetadata: {
						promptTokenCount: 4,
						candidatesTokenCount: 2,
						totalTokenCount: 7,
						thoughtsTokenCount: 1,
					},
				},
			},
		]);
		expect(out[0]?.event).toBe("message_start");
		expect(out.at(-1)?.event).toBe("message_stop");
		const messageDelta = messagesEvent(out, "message_delta")[0];
		expect(messageDelta?.["delta"]).toMatchObject({ stop_reason: "tool_use" });
	});

	it("responses 入口 ← chat 上游：输出项与终止响应", () => {
		const out = run("responses", "chat", [
			{ data: { id: "chatcmpl-1", model: "upstream-model", created: 100, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] } },
			{ data: { id: "chatcmpl-1", choices: [{ index: 0, delta: { content: "hi" } }] } },
			{
				data: {
					id: "chatcmpl-1",
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{ index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } },
								],
							},
						},
					],
				},
			},
			{ data: { id: "chatcmpl-1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] } },
			{ data: { id: "chatcmpl-1", choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } } },
		]);
		const names = out.map((event) => event.event);
		expect(names[0]).toBe("response.created");
		expect(names[1]).toBe("response.in_progress");
		expect(names.at(-1)).toBe("response.completed");
		const sequenceNumbers = out
			.map((event) => dataOf(event)["sequence_number"])
			.filter((value): value is number => typeof value === "number");
		expect(sequenceNumbers).toEqual(
			[...sequenceNumbers].sort((left, right) => left - right),
		);
		expect(new Set(sequenceNumbers).size).toBe(sequenceNumbers.length);
		const completed = dataOf(out.at(-1))["response"];
		expect(completed).toMatchObject({
			id: "resp_1",
			object: "response",
			status: "completed",
			model: "client-model",
		});
		const output = itemsAt(completed as Record<string, unknown>, "output");
		expect(output.map((item) => item["type"])).toEqual(["message", "function_call"]);
		expect(output[1]).toMatchObject({ call_id: "call_1", name: "lookup", arguments: '{"q":"x"}' });
		expect((completed as Record<string, unknown>)["usage"]).toMatchObject({
			input_tokens: 5,
			output_tokens: 2,
			total_tokens: 7,
		});
		const doneText = out.find((event) => event.event === "response.output_text.done");
		expect(dataOf(doneText)["text"]).toBe("hi");
	});

	it("responses 入口 ← messages 上游：思考、正文与工具项闭合", () => {
		const out = run("responses", "messages", [
			{
				event: "message_start",
				data: {
					type: "message_start",
					message: { id: "msg_1", model: "upstream-model", usage: { input_tokens: 10, output_tokens: 0 } },
				},
			},
			{ event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } } },
			{ event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "plan" } } },
			{ event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } } },
			{ event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
			{ event: "content_block_start", data: { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } } },
			{ event: "content_block_delta", data: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "hi" } } },
			{ event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
			{
				event: "content_block_start",
				data: { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "lookup", input: {} } },
			},
			{
				event: "content_block_delta",
				data: { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"q":"x"}' } },
			},
			{ event: "content_block_stop", data: { type: "content_block_stop", index: 2 } },
			{ event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } } },
			{ event: "message_stop", data: { type: "message_stop" } },
		]);
		const completed = dataOf(out.at(-1))["response"];
		const output = itemsAt(completed as Record<string, unknown>, "output");
		expect(output.map((item) => item["type"])).toEqual(["reasoning", "message", "function_call"]);
		expect(output[0]).toMatchObject({
			summary: [{ type: "summary_text", text: "plan" }],
			encrypted_content: "sig",
		});
		expect((completed as Record<string, unknown>)["usage"]).toMatchObject({
			input_tokens: 10,
			output_tokens: 5,
			total_tokens: 15,
		});
		const reasoningDeltas = out
			.filter((event) => event.event === "response.reasoning_summary_text.delta")
			.map((event) => dataOf(event)["delta"]);
		expect(reasoningDeltas).toEqual(["plan"]);
	});

	it("responses 入口 ← gemini 上游：候选快照聚合为输出项", () => {
		const out = run("responses", "gemini", [
			{ data: { candidates: [{ content: { role: "model", parts: [{ text: "hi" }] }, index: 0 }] } },
			{
				data: {
					candidates: [
						{
							content: { role: "model", parts: [{ functionCall: { name: "lookup", args: { q: "x" } } }] },
							finishReason: "STOP",
							index: 0,
						},
					],
					usageMetadata: {
						promptTokenCount: 4,
						candidatesTokenCount: 2,
						totalTokenCount: 7,
						thoughtsTokenCount: 1,
					},
				},
			},
		]);
		const names = out.map((event) => event.event);
		expect(names[0]).toBe("response.created");
		expect(names.at(-1)).toBe("response.completed");
		const completed = dataOf(out.at(-1))["response"];
		const output = itemsAt(completed as Record<string, unknown>, "output");
		expect(output.map((item) => item["type"])).toEqual(["message", "function_call"]);
		expect((completed as Record<string, unknown>)["usage"]).toMatchObject({
			input_tokens: 4,
			output_tokens: 3,
		});
	});

	it("上游提前结束时冲刷终止帧", () => {
		const messages = run("messages", "chat", [
			{ data: { id: "chatcmpl-1", model: "upstream-model", created: 100, choices: [{ index: 0, delta: { content: "hi" } }] } },
		]);
		expect(messages.at(-1)?.event).toBe("message_stop");
		const messageDelta = messagesEvent(messages, "message_delta")[0];
		expect(messageDelta?.["delta"]).toMatchObject({ stop_reason: "end_turn" });

		const chat = run("chat", "messages", [
			{ event: "message_start", data: { type: "message_start", message: { id: "msg_1", model: "upstream-model" } } },
		]);
		const finishChunk = chat.find((event) => {
			const choice = itemsAt(dataOf(event), "choices")[0];
			return choice?.["finish_reason"] !== undefined && choice["finish_reason"] !== null;
		});
		expect(itemsAt(dataOf(finishChunk), "choices")[0]?.["finish_reason"]).toBe("stop");
		expect(chat.at(-1)?.data).toBe("[DONE]");

		const responses = run("responses", "chat", [
			{ data: { id: "chatcmpl-1", model: "upstream-model", created: 100, choices: [{ index: 0, delta: { content: "hi" } }] } },
		]);
		const completed = dataOf(responses.at(-1) ?? { data: {} })["response"];
		expect(completed).toMatchObject({ status: "completed" });
		expect(itemsAt(completed as Record<string, unknown>, "output")[0]?.["type"]).toBe("message");
	});

	it("错误事件转换为入口协议错误帧", () => {
		const out = run("messages", "chat", [
			{ data: { error: { type: "rate_limit_error", message: "slow down" } } },
		]);
		const errorFrame = out.find((event) => event.event === "error");
		expect(errorFrame).toBeDefined();
		expect(dataOf(errorFrame)["error"]).toEqual({
			type: "rate_limit_error",
			message: "slow down",
		});
	});

	it("同协议原样透传", () => {
		const translator = createStreamTranslator("messages", "messages", {
			model: "client-model",
			upstreamModel: "upstream-model",
		});
		const event: ProtocolEvent = { event: "ping", data: { type: "ping" } };
		expect(translator.push(event)).toEqual([event]);
		expect(translator.flush()).toEqual([]);
	});
});
