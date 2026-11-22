import { describe, expect, it } from "vitest";
import { adjacentLog } from "./LogNavigationLogic";
import type { LogEntry } from "../support/LogsModels";

function row(requestId: string): LogEntry {
	return { request_id: requestId, model: "fixture/model", startTime: "2026-11-07T02:00:00Z" };
}

const list = [row("a"), row("b"), row("c")];

describe("adjacentLog", () => {
	it("会话只有当前一行时退回日志列表的相邻行", () => {
		const current = row("b");
		expect(adjacentLog([[current], list], "b", 1)?.request_id).toBe("c");
		expect(adjacentLog([[current], list], "b", -1)?.request_id).toBe("a");
	});

	it("多事件会话里先走会话内的相邻事件", () => {
		const session = [row("b"), row("x")];
		expect(adjacentLog([session, list], "b", 1)?.request_id).toBe("x");
	});

	it("会话走到头后接着走日志列表，不会停住", () => {
		const session = [row("c"), row("b")];
		expect(adjacentLog([session, list], "b", 1)?.request_id).toBe("c");
		expect(adjacentLog([session, list], "c", -1)?.request_id).toBe("b");
	});

	it("没有会话时只看日志列表", () => {
		expect(adjacentLog([list], "b", 1)?.request_id).toBe("c");
		expect(adjacentLog([list], "a", -1)).toBeNull();
		expect(adjacentLog([list], "c", 1)).toBeNull();
	});

	it("当前行不在任何序列里时返回 null", () => {
		expect(adjacentLog([[row("b")], list], "zzz", 1)).toBeNull();
	});
});
