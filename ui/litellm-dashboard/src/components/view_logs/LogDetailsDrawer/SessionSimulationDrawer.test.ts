import { describe, expect, it } from "vitest";
import type { SessionTimelineEvent } from "../../networking";
import { orderSessionTimeline } from "./SessionSimulationDrawer";

function makeEvent(overrides: Partial<SessionTimelineEvent>): SessionTimelineEvent {
	return {
		id: "req-1:request:0",
		request_id: "req-1",
		role: "user",
		label: "用户输入",
		timestamp: "2026-07-24T10:00:00.000Z",
		model: "claude",
		content: "第一问",
		...overrides,
	};
}

describe("orderSessionTimeline", () => {
	it("支持按真实事件时间最新优先展示，且不修改服务端返回数组", () => {
		const timeline = [
			makeEvent({ id: "req-1:user", content: "第一问" }),
			makeEvent({
				id: "req-1:assistant",
				role: "assistant",
				label: "输出",
				timestamp: "2026-07-24T10:00:10.000Z",
				content: "第一答",
			}),
			makeEvent({
				id: "req-2:user",
				request_id: "req-2",
				timestamp: "2026-07-24T10:00:02.000Z",
				content: "第二问",
			}),
			makeEvent({
				id: "req-2:assistant",
				request_id: "req-2",
				role: "assistant",
				label: "输出",
				timestamp: "2026-07-24T10:00:03.000Z",
				content: "第二答",
			}),
		];

		expect(orderSessionTimeline(timeline, true).map((item) => item.content)).toEqual([
			"第一答",
			"第二答",
			"第二问",
			"第一问",
		]);
		expect(timeline.map((item) => item.content)).toEqual(["第一问", "第一答", "第二问", "第二答"]);
	});
});
