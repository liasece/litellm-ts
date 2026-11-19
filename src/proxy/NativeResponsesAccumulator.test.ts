import { NativeResponsesAccumulator } from "./NativeResponsesAccumulator";

function outputItems(snapshot: Record<string, unknown> | null): Array<Record<string, unknown>> {
	expect(snapshot).not.toBeNull();
	return (snapshot as Record<string, unknown>)["output"] as Array<Record<string, unknown>>;
}

function messageText(item: Record<string, unknown>): string {
	return ((item["content"] as Array<Record<string, unknown>>) ?? [])
		.map((part) => (typeof part["text"] === "string" ? part["text"] : ""))
		.join("");
}

describe("NativeResponsesAccumulator", () => {
	it("增量与 completed output 描述同一段文本时只保留一份", () => {
		const accumulator = new NativeResponsesAccumulator();
		accumulator.accumulate({ type: "response.created", response: { id: "resp_1", model: "m", status: "in_progress" } });
		accumulator.accumulate({ type: "response.output_text.delta", item_id: "msg_1", delta: "你好" });
		accumulator.accumulate({
			type: "response.output_item.done",
			item: {
				id: "msg_1",
				type: "message",
				role: "assistant",
				status: "completed",
				content: [{ type: "output_text", text: "你好" }],
			},
		});
		accumulator.accumulate({
			type: "response.completed",
			response: {
				id: "resp_1",
				model: "m",
				status: "completed",
				output: [
					{
						id: "msg_1",
						type: "message",
						role: "assistant",
						status: "completed",
						content: [{ type: "output_text", text: "你好" }],
					},
				],
			},
		});

		const messages = outputItems(accumulator.snapshot()).filter((item) => item["type"] === "message");
		expect(messages).toHaveLength(1);
		expect(messageText(messages[0]!)).toBe("你好");
	});

	it("只观察到增量时补一条合成消息", () => {
		const accumulator = new NativeResponsesAccumulator();
		accumulator.accumulate({ type: "response.created", response: { id: "resp_2", model: "m", status: "in_progress" } });
		accumulator.accumulate({ type: "response.output_text.delta", item_id: "msg_2", delta: "只有增量" });

		const messages = outputItems(accumulator.snapshot()).filter((item) => item["type"] === "message");
		expect(messages).toHaveLength(1);
		expect(messageText(messages[0]!)).toBe("只有增量");
	});

	it("推理增量与 reasoning item 重复时也只保留一份", () => {
		const accumulator = new NativeResponsesAccumulator();
		accumulator.accumulate({ type: "response.created", response: { id: "resp_3", model: "m", status: "in_progress" } });
		accumulator.accumulate({ type: "response.reasoning_summary_text.delta", item_id: "rs_3", delta: "先看颜色" });
		accumulator.accumulate({
			type: "response.completed",
			response: {
				id: "resp_3",
				model: "m",
				status: "completed",
				output: [
					{
						id: "rs_3",
						type: "reasoning",
						summary: [{ type: "summary_text", text: "先看颜色" }],
					},
				],
			},
		});

		const reasoning = outputItems(accumulator.snapshot()).filter((item) => item["type"] === "reasoning");
		expect(reasoning).toHaveLength(1);
	});

	it("终态事件保留上游完整响应，供内部调用审计行保存真实响应", () => {
		const accumulator = new NativeResponsesAccumulator();
		accumulator.accumulate({ type: "response.created", response: { id: "resp_4", model: "m", status: "in_progress" } });
		accumulator.accumulate({ type: "response.output_text.delta", item_id: "msg_4", delta: "完成" });
		accumulator.accumulate({
			type: "response.completed",
			response: {
				id: "resp_4",
				object: "response",
				model: "m",
				status: "completed",
				output: [
					{
						id: "msg_4",
						type: "message",
						role: "assistant",
						status: "completed",
						content: [{ type: "output_text", text: "完成" }],
					},
				],
				usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
			},
		});

		expect(accumulator.finalResponse()).toMatchObject({
			id: "resp_4",
			object: "response",
			status: "completed",
			usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
		});
		// snapshot 仍是网关内部的部分响应视图，不能替代上游终态响应。
		expect(accumulator.snapshot()?.["status"]).toBe("in_progress");
	});

	it("没有终态事件时不伪造上游响应", () => {
		const accumulator = new NativeResponsesAccumulator();
		accumulator.accumulate({ type: "response.created", response: { id: "resp_5", model: "m", status: "in_progress" } });
		accumulator.accumulate({ type: "response.output_text.delta", item_id: "msg_5", delta: "未完成" });

		expect(accumulator.finalResponse()).toBeUndefined();
	});
});
