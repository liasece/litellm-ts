import {
	createAnthropicStreamLogAccumulator,
	createChatStreamLogAccumulator,
	createLiveStreamCheckpoint,
	createResponsesStreamLogAccumulator,
} from "./CliProxyStreamLogAccumulator";

const mockCheckpointActiveRequest = jest.fn(async (_db: unknown, _requestId: unknown, _payload: unknown, _key: unknown) => true);

jest.mock("../spend/SpendTracker", () => {
	const actual = jest.requireActual<typeof import("../spend/SpendTracker")>("../spend/SpendTracker");
	return {
		...actual,
		checkpointActiveRequest: (db: unknown, requestId: string, payload: unknown, key?: string) =>
			mockCheckpointActiveRequest(db, requestId, payload, key),
	};
});

/** 构造一帧 chat.completion.chunk 的 SSE 文本。 */
function chatFrame(delta: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
	return `data: ${JSON.stringify({
		id: "chatcmpl-1",
		object: "chat.completion.chunk",
		created: 1,
		model: "cliproxy/demo",
		choices: [{ index: 0, delta: delta, finish_reason: null }],
		...extra,
	})}\n\n`;
}

/** 构造一帧 Responses API SSE 事件。 */
function responsesFrame(payload: Record<string, unknown>): string {
	return `event: ${String(payload["type"] ?? "response")}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/** 构造一帧 Anthropic Messages SSE 事件。 */
function anthropicFrame(payload: Record<string, unknown>): string {
	return `event: ${String(payload["type"] ?? "message")}\ndata: ${JSON.stringify(payload)}\n\n`;
}

describe("CLIProxy 透传流日志累积器", () => {
	it("累积被任意切分的 chat 流，并在流结束前就能读到部分响应", () => {
		const accumulator = createChatStreamLogAccumulator();
		const stream =
			chatFrame({ role: "assistant", content: "第一段" }) +
			chatFrame({ content: "第二段" }) +
			chatFrame({}, { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 5 } });

		// 逐字节喂入：半帧必须留在缓冲区，不能丢内容也不能提前报错。
		for (const character of stream.slice(0, stream.indexOf("第二段"))) {
			accumulator.feed(character);
		}
		const partial = accumulator.snapshot();
		expect((partial?.response?.["choices"] as Array<{ message: { content: string } }>)[0]?.message.content).toBe("第一段");

		accumulator.feed(stream.slice(stream.indexOf("第二段")));
		accumulator.finish();
		const snapshot = accumulator.snapshot();
		const choices = snapshot?.response?.["choices"] as Array<{ message: { content: string }; finish_reason: string }>;
		expect(choices[0]?.message.content).toBe("第一段第二段");
		expect(choices[0]?.finish_reason).toBe("stop");
		expect(snapshot?.response?.["object"]).toBe("chat.completion");
		expect(snapshot?.usage).toEqual({ prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 });
	});

	it("合并位置型工具调用增量，保留每个 index 的参数文本", () => {
		const accumulator = createChatStreamLogAccumulator();
		accumulator.feed(
			chatFrame({
				tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: '{"q":' } }],
			}),
		);
		accumulator.feed(chatFrame({ tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }));
		accumulator.finish();

		const choices = accumulator.snapshot()?.response?.["choices"] as Array<{
			message: { tool_calls: Array<{ id: string; function: { name: string; arguments: string } }> };
		}>;
		expect(choices[0]?.message.tool_calls).toEqual([
			{ id: "call_1", function: { name: "lookup", arguments: '{"q":"x"}' } },
		]);
	});

	it("还没有任何 choice 时不产出快照，首个 chunk 之后给出空壳响应", () => {
		const accumulator = createChatStreamLogAccumulator();
		// 连 role 帧都没到：没有可写的内容，调度器应跳过这次写库。
		expect(accumulator.snapshot()).toBeUndefined();
		// 首帧只带 role（上游常见），与兼容端点一致：产出 content 为 null 的空壳。
		accumulator.feed(chatFrame({ role: "assistant" }));
		const choices = accumulator.snapshot()?.response?.["choices"] as Array<{ message: { role: string; content: null } }>;
		expect(choices[0]?.message).toEqual({ role: "assistant", content: null });
	});

	it("累积 Anthropic Messages 的文本块与分段 usage", () => {
		const accumulator = createAnthropicStreamLogAccumulator();
		accumulator.feed(
			anthropicFrame({
				type: "message_start",
				message: { id: "msg_1", type: "message", role: "assistant", content: [], usage: { input_tokens: 11 } },
			}),
		);
		accumulator.feed(anthropicFrame({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
		accumulator.feed(anthropicFrame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "你好" } }));
		expect(
			(accumulator.snapshot()?.response?.["content"] as Array<{ text: string }>)[0]?.text,
		).toBe("你好");

		accumulator.feed(anthropicFrame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "，世界" } }));
		accumulator.feed(anthropicFrame({ type: "content_block_stop", index: 0 }));
		accumulator.feed(
			anthropicFrame({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } }),
		);
		accumulator.finish();

		const response = accumulator.snapshot()?.response;
		expect((response?.["content"] as Array<{ text: string }>)[0]?.text).toBe("你好，世界");
		expect(response?.["stop_reason"]).toBe("end_turn");
		expect(accumulator.snapshot()?.usage).toMatchObject({ prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 });
	});
});

describe("CLIProxy Responses 协议累积器", () => {
	it("跨帧累积 output_text，进行中就能读出部分响应", () => {
		const accumulator = createResponsesStreamLogAccumulator();
		const stream =
			responsesFrame({ type: "response.created", response: { id: "resp_1", model: "gpt-5.6-terra", output: [] } }) +
			responsesFrame({ type: "response.output_text.delta", output_index: 0, delta: "上半" }) +
			responsesFrame({ type: "response.output_text.delta", output_index: 0, delta: "段" });

		accumulator.feed(stream.slice(0, 120));
		expect(accumulator.snapshot()).toBeUndefined();
		accumulator.feed(stream.slice(120));
		const partial = accumulator.snapshot();
		expect(partial?.response?.["status"]).toBe("in_progress");
		expect(partial?.response?.["id"]).toBe("resp_1");
		const output = partial?.response?.["output"] as Array<{ type: string; content: Array<{ text: string }> }>;
		expect(output[0]?.type).toBe("message");
		expect(output[0]?.content[0]?.text).toBe("上半段");
	});

	it("终态事件带来的 usage 会写进快照", () => {
		const accumulator = createResponsesStreamLogAccumulator();
		accumulator.feed(
			responsesFrame({ type: "response.created", response: { id: "resp_2", model: "gpt-5.6-terra", output: [] } }),
		);
		accumulator.feed(responsesFrame({ type: "response.output_text.delta", output_index: 0, delta: "正文" }));
		accumulator.feed(
			responsesFrame({
				type: "response.completed",
				response: {
					id: "resp_2",
					status: "completed",
					output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "正文" }] }],
					usage: { input_tokens: 11, output_tokens: 7 },
				},
			}),
		);
		accumulator.finish();

		const snapshot = accumulator.snapshot();
		expect(snapshot?.usage).toMatchObject({ input_tokens: 11, output_tokens: 7 });
		const output = snapshot?.response?.["output"] as Array<{ content: Array<{ text: string }> }>;
		expect(output[0]?.content[0]?.text).toBe("正文");
	});
});

describe("CLIProxy 透传流的实时 checkpoint", () => {
	/** 读出第 index 次 checkpoint 写入的 partial response 文本。 */
	const checkpointContent = (index: number): string => {
		const checkpoint = mockCheckpointActiveRequest.mock.calls[index]?.[2] as
			| { response?: { choices?: Array<{ message?: { content?: string | null } }> } }
			| undefined;
		return checkpoint?.response?.choices?.[0]?.message?.content ?? "";
	};

	beforeEach(() => {
		mockCheckpointActiveRequest.mockClear();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("流进行中按窗口写出增长的 streaming_execution，收尾补上最后一段", async () => {
		jest.useFakeTimers();
		const checkpoint = createLiveStreamCheckpoint({
			db: {} as never,
			requestId: "req-live",
			protocol: "chat_completions",
			currentUpstreamRequest: () => ({ model: "cliproxy/demo" }),
		});

		checkpoint.feed(chatFrame({ role: "assistant", content: "上半段" }));
		await jest.advanceTimersByTimeAsync(500);
		expect(mockCheckpointActiveRequest).toHaveBeenCalledTimes(1);
		expect(checkpointContent(0)).toBe("上半段");

		checkpoint.feed(chatFrame({ content: "下半段" }));
		await jest.advanceTimersByTimeAsync(500);
		expect(mockCheckpointActiveRequest).toHaveBeenCalledTimes(2);
		expect(checkpointContent(1)).toBe("上半段下半段");

		// 窗口内到达的最后一段内容必须随收尾落盘，否则最终日志之前的那一段永远看不到。
		checkpoint.feed(chatFrame({ content: "收尾" }));
		await checkpoint.dispose();
		expect(mockCheckpointActiveRequest).toHaveBeenCalledTimes(3);
		expect(checkpointContent(2)).toBe("上半段下半段收尾");

		// 重复收尾（正常路径与 finally 各调一次）不应再写一行已删除的记录。
		await checkpoint.dispose();
		expect(mockCheckpointActiveRequest).toHaveBeenCalledTimes(3);

		const [dbArg, requestId, , key] = mockCheckpointActiveRequest.mock.calls[0]!;
		expect(dbArg).toEqual({});
		expect(requestId).toBe("req-live");
		expect(key).toBe("streaming_execution");
	});

	it("首个 chunk 只补写一次 TTFT，后续 chunk 不重复标记", async () => {
		jest.useFakeTimers();
		const onFirstChunk = jest.fn();
		const checkpoint = createLiveStreamCheckpoint({
			db: {} as never,
			requestId: "req-ttft",
			protocol: "chat_completions",
			currentUpstreamRequest: () => undefined,
			onFirstChunk: onFirstChunk,
		});

		checkpoint.feed(chatFrame({ role: "assistant", content: "首" }));
		checkpoint.feed(chatFrame({ content: "个" }));
		await jest.advanceTimersByTimeAsync(500);
		await checkpoint.dispose();

		expect(onFirstChunk).toHaveBeenCalledTimes(1);
	});

	it("Responses 透传按窗口写出可渲染的 output 增量", async () => {
		jest.useFakeTimers();
		const checkpoint = createLiveStreamCheckpoint({
			db: {} as never,
			requestId: "req-responses",
			protocol: "responses_native",
			currentUpstreamRequest: () => ({ url: "http://127.0.0.1:8317/v1/responses" }),
		});

		checkpoint.feed(
			responsesFrame({ type: "response.created", response: { id: "resp_1", model: "gpt-5.6-terra", output: [] } }),
		);
		checkpoint.feed(responsesFrame({ type: "response.output_text.delta", output_index: 0, delta: "第一段" }));
		await jest.advanceTimersByTimeAsync(500);
		expect(mockCheckpointActiveRequest).toHaveBeenCalledTimes(1);

		checkpoint.feed(responsesFrame({ type: "response.output_text.delta", output_index: 0, delta: "第二段" }));
		await jest.advanceTimersByTimeAsync(500);
		await checkpoint.dispose();

		const readOutputText = (index: number): string => {
			const payload = mockCheckpointActiveRequest.mock.calls[index]?.[2] as
				| { response?: { output?: Array<{ content?: Array<{ text?: string }> }> } }
				| undefined;
			return payload?.response?.output?.[0]?.content?.[0]?.text ?? "";
		};
		expect(readOutputText(0)).toBe("第一段");
		expect(readOutputText(1)).toBe("第一段第二段");
	});

	it("checkpoint 里带上协议、进行中状态与上游请求，供详情页的 Upstream 视图使用", async () => {
		jest.useFakeTimers();
		const checkpoint = createLiveStreamCheckpoint({
			db: {} as never,
			requestId: "req-anthropic",
			protocol: "anthropic_messages",
			currentUpstreamRequest: () => ({ model: "cliproxy/demo", url: "http://127.0.0.1:8317/v1/messages" }),
		});
		checkpoint.feed(
			anthropicFrame({
				type: "message_start",
				message: { id: "msg_1", type: "message", role: "assistant", content: [], usage: { input_tokens: 3 } },
			}),
		);
		await jest.advanceTimersByTimeAsync(500);
		await checkpoint.dispose();

		const payload = mockCheckpointActiveRequest.mock.calls[0]![2] as Record<string, unknown>;
		expect(payload["protocol"]).toBe("anthropic_messages");
		expect(payload["state"]).toBe("in_progress");
		expect(payload["upstream_request"]).toEqual({ model: "cliproxy/demo", url: "http://127.0.0.1:8317/v1/messages" });
		expect(payload["usage"]).toMatchObject({ prompt_tokens: 3, completion_tokens: 0, total_tokens: 3 });
	});
});
