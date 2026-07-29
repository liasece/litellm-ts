import { SessionTimelineBuilder, type SessionTimelineSourceRow } from "./sessionTimeline";

function makeRow(overrides: Partial<SessionTimelineSourceRow>): SessionTimelineSourceRow {
	return {
		request_id: "req-1",
		call_type: "completion",
		spend: 0.01,
		total_tokens: 10,
		startTime: "2026-07-24T10:00:00.000Z",
		endTime: "2026-07-24T10:00:01.000Z",
		model: "claude",
		status: "success",
		metadata_status: null,
		error_information: null,
		request_payload: {},
		response_payload: {},
		...overrides,
	};
}

describe("SessionTimelineBuilder", () => {
	it("去掉累计请求快照中的历史消息，同时保留再次真实发送的相同文本", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_payload: [{ role: "user", content: "继续" }],
				response_payload: { choices: [{ message: { role: "assistant", content: "第一次回复" } }] },
			}),
		);
		builder.add(
			makeRow({
				request_id: "req-2",
				startTime: "2026-07-24T10:00:02.000Z",
				endTime: "2026-07-24T10:00:03.000Z",
				request_payload: {
					messages: [
						{ role: "user", content: "继续" },
						{ role: "assistant", content: "第一次回复" },
						{ role: "user", content: "继续" },
					],
				},
				response_payload: { choices: [{ message: { role: "assistant", content: "第二次回复" } }] },
			}),
		);

		const result = builder.build();
		expect(result.data.map((item) => [item.role, item.content])).toEqual([
			["user", "继续"],
			["assistant", "第一次回复"],
			["user", "继续"],
			["assistant", "第二次回复"],
		]);
		expect(result.summary).toMatchObject({
			request_count: 2,
			event_count: 4,
			total_spend: 0.02,
			total_tokens: 20,
			duration_seconds: 3,
		});
	});

	it("在交错的长短快照中按语义去重历史，并忽略响应与历史间的 reasoning 差异", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_payload: { messages: [{ role: "user", content: "根请求" }] },
				response_payload: {
					choices: [
						{
							message: {
								role: "assistant",
								content: "回复 A",
								reasoning_content: "响应中有、后续历史中没有的推理",
							},
						},
					],
				},
			}),
		);
		builder.add(
			makeRow({
				request_id: "req-2",
				startTime: "2026-07-24T10:00:02.000Z",
				endTime: "2026-07-24T10:00:03.000Z",
				request_payload: {
					messages: [
						{ role: "user", content: "根请求" },
						{ role: "assistant", content: "回复 A" },
						{ role: "user", content: "分支 B" },
					],
				},
				response_payload: { choices: [{ message: { role: "assistant", content: "回复 B" } }] },
			}),
		);
		builder.add(
			makeRow({
				request_id: "req-3",
				startTime: "2026-07-24T10:00:04.000Z",
				endTime: "2026-07-24T10:00:05.000Z",
				request_payload: {
					messages: [
						{ role: "user", content: "根请求" },
						{ role: "user", content: "短分支 C" },
					],
				},
				response_payload: { choices: [{ message: { role: "assistant", content: "回复 C" } }] },
			}),
		);
		builder.add(
			makeRow({
				request_id: "req-4",
				startTime: "2026-07-24T10:00:06.000Z",
				endTime: "2026-07-24T10:00:07.000Z",
				request_payload: {
					messages: [
						{ role: "user", content: "根请求" },
						{ role: "assistant", content: "回复 A" },
						{ role: "user", content: "分支 B" },
						{ role: "assistant", content: "回复 B" },
						{ role: "user", content: "继续主分支 D" },
					],
				},
				response_payload: { choices: [{ message: { role: "assistant", content: "回复 D" } }] },
			}),
		);

		expect(builder.build().data.map((item) => [item.request_id, item.role, item.content])).toEqual([
			["req-1", "user", "根请求"],
			["req-1", "assistant", "[Thinking]\n响应中有、后续历史中没有的推理\n回复 A"],
			["req-2", "user", "分支 B"],
			["req-2", "assistant", "回复 B"],
			["req-3", "user", "短分支 C"],
			["req-3", "assistant", "回复 C"],
			["req-4", "user", "继续主分支 D"],
			["req-4", "assistant", "回复 D"],
		]);
	});

	it("将工具输出附着到对应工具请求，不把它伪装成用户输入", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_payload: {
					messages: [
						{
							role: "assistant",
							content: [{ type: "tool_use", id: "tool-1", name: "search", input: { q: "world cup" } }],
						},
						{
							role: "user",
							content: [{ type: "tool_result", tool_use_id: "tool-1", content: "result" }],
						},
					],
				},
			}),
		);

		const result = builder.build();
		const toolEvent = result.data.find((item) => item.parts?.some((part) => part.kind === "tool_call"));
		expect(toolEvent?.parts?.map((part) => part.kind)).toEqual(["tool_call", "tool_result"]);
		expect(result.data.some((item) => item.role === "user" && item.content === "result")).toBe(false);
	});

	it("为无响应的失败请求生成可渲染错误事件", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				status: "failure",
				error_information: { error_message: "provider unavailable" },
			}),
		);

		expect(builder.build().data).toEqual([
			expect.objectContaining({
				request_id: "req-1",
				role: "error",
				content: "provider unavailable",
				status: "failure",
			}),
		]);
	});
});
