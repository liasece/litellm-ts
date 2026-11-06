/** DeepSeek 原生 Responses 推理回显补齐测试。 */

import { DEEPSEEK_REASONING_PLACEHOLDER, backfillDeepSeekResponsesReasoning } from "./deepseekResponsesHistory";

const tools = [{ type: "function", name: "get_time", parameters: { type: "object", properties: {} } }];
const user = { role: "user", content: "现在几点？" };
const call = { type: "function_call", call_id: "call_1", name: "get_time", arguments: "{}" };
const secondCall = { type: "function_call", call_id: "call_2", name: "get_time", arguments: "{}" };
const output = { type: "function_call_output", call_id: "call_1", output: "18:30" };
const secondOutput = { type: "function_call_output", call_id: "call_2", output: "18:31" };
const reasoning = { type: "reasoning", content: [{ type: "reasoning_text", text: "先查时间" }] };

function reasoningText(item: unknown): string | undefined {
	const record = item as { type?: string; content?: Array<{ type?: string; text?: string }> };
	if (record.type !== "reasoning") {
		return undefined;
	}
	return record.content?.find((part) => part.type === "reasoning_text")?.text;
}

describe("backfillDeepSeekResponsesReasoning", () => {
	it("请求没有停在工具循环时不改写，返回同一对象", () => {
		const body = { input: [user, call, output, { role: "user", content: "谢谢" }], tools };

		expect(backfillDeepSeekResponsesReasoning(body)).toBe(body);
	});

	it("当前轮的调用缺少推理时，在首个 function_call 之前插入占位 reasoning", () => {
		const body = { input: [user, call, output], tools };

		const result = backfillDeepSeekResponsesReasoning(body);
		const input = result["input"] as unknown[];

		expect(input).toHaveLength(4);
		expect(input[1]).toEqual({ type: "reasoning", content: [{ type: "reasoning_text", text: DEEPSEEK_REASONING_PLACEHOLDER }] });
		expect(input[2]).toEqual(call);
		expect(input[3]).toEqual(output);
		// 调用方数组不被修改
		expect(body.input).toHaveLength(3);
	});

	it("当前轮已经回传非空推理时保持请求体不变", () => {
		const body = { input: [user, reasoning, call, output], tools };

		expect(backfillDeepSeekResponsesReasoning(body)).toBe(body);
	});

	it("空 content 或仅 summary 的 reasoning 不算回显，仍然补位", () => {
		const emptyContent = { type: "reasoning", content: [] };
		const summaryOnly = { type: "reasoning", summary: [{ type: "summary_text", text: "查时间" }] };

		const first = backfillDeepSeekResponsesReasoning({ input: [user, emptyContent, call, output], tools });
		const second = backfillDeepSeekResponsesReasoning({ input: [user, summaryOnly, call, output], tools });

		// 占位插在调用之前，原有的空 content 项保持不动
		expect((first["input"] as unknown[])[1]).toEqual(emptyContent);
		expect((second["input"] as unknown[])[1]).toEqual(summaryOnly);
		expect(reasoningText((first["input"] as unknown[])[2])).toBe(DEEPSEEK_REASONING_PLACEHOLDER);
		expect(reasoningText((second["input"] as unknown[])[2])).toBe(DEEPSEEK_REASONING_PLACEHOLDER);
	});

	it("历史轮次（最后一条 user 之前）缺失推理不影响改写", () => {
		const body = { input: [user, call, output, { role: "user", content: "再来一次" }, reasoning, secondCall, secondOutput], tools };

		expect(backfillDeepSeekResponsesReasoning(body)).toBe(body);
	});

	it("已关闭思考时不补位", () => {
		const body = { input: [user, call, output], tools, reasoning: { effort: "none" } };

		expect(backfillDeepSeekResponsesReasoning(body)).toBe(body);
	});

	it("同一段 assistant 先发文本消息再调用工具时，占位插在文本消息之前", () => {
		const message = { type: "message", role: "assistant", content: [{ type: "output_text", text: "先查一下时间" }] };
		const body = { input: [user, message, call, output], tools };

		const input = backfillDeepSeekResponsesReasoning(body)["input"] as unknown[];

		expect(input).toHaveLength(5);
		expect(reasoningText(input[1])).toBe(DEEPSEEK_REASONING_PLACEHOLDER);
		expect(input[2]).toEqual(message);
		expect(input[3]).toEqual(call);
		expect(input[4]).toEqual(output);
	});

	it("多段时每段的占位都落在该段 assistant 文本消息之前", () => {
		const firstMessage = { type: "message", role: "assistant", content: [{ type: "output_text", text: "先查时间" }] };
		const secondMessage = { type: "message", role: "assistant", content: [{ type: "output_text", text: "再查一次" }] };
		const body = { input: [user, firstMessage, call, output, secondMessage, secondCall, secondOutput], tools };

		const input = backfillDeepSeekResponsesReasoning(body)["input"] as unknown[];

		expect(reasoningText(input[1])).toBe(DEEPSEEK_REASONING_PLACEHOLDER);
		expect(input[2]).toEqual(firstMessage);
		expect(reasoningText(input[5])).toBe(DEEPSEEK_REASONING_PLACEHOLDER);
		expect(input[6]).toEqual(secondMessage);
	});

	it("同一段的多个并行调用只补一条占位", () => {
		const body = { input: [user, call, secondCall, output, secondOutput], tools };

		const input = backfillDeepSeekResponsesReasoning(body)["input"] as unknown[];

		expect(input).toHaveLength(6);
		expect(reasoningText(input[1])).toBe(DEEPSEEK_REASONING_PLACEHOLDER);
		expect(input[2]).toEqual(call);
		expect(input[3]).toEqual(secondCall);
	});

	it("同一轮内两段调用各自判定：缺推理的段各补一条", () => {
		const body = { input: [user, call, output, secondCall, secondOutput], tools };

		const input = backfillDeepSeekResponsesReasoning(body)["input"] as unknown[];

		expect(input).toHaveLength(7);
		expect(reasoningText(input[1])).toBe(DEEPSEEK_REASONING_PLACEHOLDER);
		expect(reasoningText(input[4])).toBe(DEEPSEEK_REASONING_PLACEHOLDER);
	});

	it("没有 tools 的请求不补位", () => {
		const body = { input: [user, call, output] };

		expect(backfillDeepSeekResponsesReasoning(body)).toBe(body);
	});

	it("重复处理同一份请求体不会叠加占位", () => {
		const body = { input: [user, call, output], tools };

		const once = backfillDeepSeekResponsesReasoning(body);
		const twice = backfillDeepSeekResponsesReasoning(once);

		expect(twice).toBe(once);
	});
});
