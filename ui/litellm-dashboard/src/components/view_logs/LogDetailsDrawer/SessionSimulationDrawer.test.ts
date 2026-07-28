import { beforeEach, describe, expect, it, vi } from "vitest";
import { uiSpendLogDetailsBatchCall, uiSpendLogDetailsCall } from "../../networking";
import type { LogEntry } from "../columns";
import { buildSessionTimeline, enrichMissingDetails, orderSessionTimeline } from "./SessionSimulationDrawer";

vi.mock("../../networking", () => ({
	sessionSpendLogsCall: vi.fn(),
	uiSpendLogDetailsBatchCall: vi.fn(),
	uiSpendLogDetailsCall: vi.fn(),
}));

function makeLog(overrides: Partial<LogEntry>): LogEntry {
	return {
		request_id: "req-1",
		api_key: "key",
		team_id: "team",
		model: "claude",
		model_id: "claude-id",
		call_type: "completion",
		spend: 0.01,
		total_tokens: 10,
		prompt_tokens: 6,
		completion_tokens: 4,
		startTime: "2026-07-24T10:00:00.000Z",
		endTime: "2026-07-24T10:00:01.000Z",
		cache_hit: "miss",
		messages: [],
		response: {},
		metadata: { status: "success" },
		...overrides,
	};
}

describe("buildSessionTimeline", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("按时间重建会话，并去掉后续请求重复携带的历史消息", () => {
		const first = makeLog({
			request_id: "req-1",
			messages: [{ role: "user", content: "第一问" }],
			response: { choices: [{ message: { role: "assistant", content: "第一答" } }] },
		});
		const second = makeLog({
			request_id: "req-2",
			startTime: "2026-07-24T10:00:02.000Z",
			endTime: "2026-07-24T10:00:03.000Z",
			messages: [
				{ role: "user", content: "第一问" },
				{ role: "assistant", content: "第一答" },
				{ role: "user", content: "第二问" },
			],
			response: { choices: [{ message: { role: "assistant", content: "第二答" } }] },
		});

		const timeline = buildSessionTimeline([second, first]);

		expect(timeline.map((item) => [item.role, item.content])).toEqual([
			["user", "第一问"],
			["assistant", "第一答"],
			["user", "第二问"],
			["assistant", "第二答"],
		]);
	});

	it("同样的用户文本被再次真实发送时仍保留为新事件", () => {
		const first = makeLog({
			request_id: "req-1",
			messages: [{ role: "user", content: "继续" }],
			response: { choices: [{ message: { role: "assistant", content: "第一次回复" } }] },
		});
		const second = makeLog({
			request_id: "req-2",
			startTime: "2026-07-24T10:00:02.000Z",
			endTime: "2026-07-24T10:00:03.000Z",
			messages: [
				{ role: "user", content: "继续" },
				{ role: "assistant", content: "第一次回复" },
				{ role: "user", content: "继续" },
			],
			response: { choices: [{ message: { role: "assistant", content: "第二次回复" } }] },
		});

		const timeline = buildSessionTimeline([first, second]);

		expect(timeline.filter((item) => item.role === "user" && item.content === "继续")).toHaveLength(2);
	});

	it("保留工具调用/结果细节，并为失败请求生成明确事件", () => {
		const toolLog = makeLog({
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
		});
		const failedLog = makeLog({
			request_id: "req-failed",
			startTime: "2026-07-24T10:00:02.000Z",
			endTime: "2026-07-24T10:00:03.000Z",
			status: "failure",
			metadata: { status: "failure", error_information: { error_message: "provider unavailable" } },
		});

		const timeline = buildSessionTimeline([toolLog, failedLog]);
		const toolEvent = timeline.find((item) => item.parts?.some((part) => part.kind === "tool_call"));

		expect(toolEvent?.parts?.map((part) => part.kind)).toEqual(["tool_call", "tool_result"]);
		expect(timeline.some((item) => item.role === "user" && item.content === "result")).toBe(false);
		expect(timeline.at(-1)).toMatchObject({ role: "error", content: "provider unavailable" });
	});

	it("支持将时间线按最新事件优先倒序展示，且不修改原数组", () => {
		const timeline = buildSessionTimeline([
			makeLog({
				request_id: "req-1",
				endTime: "2026-07-24T10:00:10.000Z",
				messages: [{ role: "user", content: "第一问" }],
				response: { choices: [{ message: { role: "assistant", content: "第一答" } }] },
			}),
			makeLog({
				request_id: "req-2",
				startTime: "2026-07-24T10:00:02.000Z",
				endTime: "2026-07-24T10:00:03.000Z",
				messages: [{ role: "user", content: "第二问" }],
				response: { choices: [{ message: { role: "assistant", content: "第二答" } }] },
			}),
		]);

		expect(orderSessionTimeline(timeline, true).map((item) => item.content)).toEqual([
			"第一答",
			"第二答",
			"第二问",
			"第一问",
		]);
		expect(timeline.map((item) => item.content)).toEqual(["第一问", "第一答", "第二问", "第二答"]);
	});

	it("缺失重列通过一个批量请求补齐，不逐条请求详情", async () => {
		const logs = [
			makeLog({ request_id: "req-1", messages: [], response: {} }),
			makeLog({ request_id: "req-2", messages: [], response: {} }),
		];
		vi.mocked(uiSpendLogDetailsBatchCall).mockResolvedValue({
			data: [
				{ request_id: "req-1", messages: [{ role: "user", content: "first" }], response: { id: "one" } },
				{ request_id: "req-2", messages: [{ role: "user", content: "second" }], response: { id: "two" } },
			],
		});

		const enriched = await enrichMissingDetails("unused-token", logs);

		expect(uiSpendLogDetailsBatchCall).toHaveBeenCalledOnce();
		expect(uiSpendLogDetailsBatchCall).toHaveBeenCalledWith("unused-token", [
			{ request_id: "req-1", start_date: logs[0].startTime },
			{ request_id: "req-2", start_date: logs[1].startTime },
		]);
		expect(uiSpendLogDetailsCall).not.toHaveBeenCalled();
		expect(enriched.map((log) => log.response)).toEqual([{ id: "one" }, { id: "two" }]);
	});
});
