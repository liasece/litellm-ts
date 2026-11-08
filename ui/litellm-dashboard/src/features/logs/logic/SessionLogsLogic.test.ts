import { describe, expect, it, vi } from "vitest";
import { loadCompleteSessionLogs } from "./SessionLogsLogic";
import type { LogEntry, SessionLogsPage } from "../support/LogsModels";

const row = (id: string, start = "2026-11-07T02:00:00Z"): LogEntry => ({
	request_id: id,
	startTime: start,
	endTime: "2026-11-07T02:00:02Z",
});
const page = (data: LogEntry[], extra: Partial<SessionLogsPage> = {}): SessionLogsPage => ({
	data,
	total: data.length,
	page: 1,
	page_size: 100,
	total_pages: 1,
	...extra,
});
describe("complete session trace loading", () => {
	it("keeps the server snapshot and total through cursor pagination before opening a complete trace", async () => {
		const session = vi
			.fn()
			.mockResolvedValueOnce(page([row("first")], { total: 2, snapshot: "snapshot-1", next_cursor: "next" }))
			.mockResolvedValueOnce(page([row("second", "2026-11-07T01:00:00Z")], { total: 2, snapshot: "snapshot-1", next_cursor: null }));
		const logs = await loadCompleteSessionLogs(
			{ type: "claude_code_user_id", id: "research session" },
			{ includeContent: true, teamId: "research" },
			{ session },
		);
		expect(session.mock.calls[1][1]).toMatchObject({
			snapshot: "snapshot-1",
			cursor: "next",
			knownTotal: 2,
			includeContent: true,
			teamId: "research",
		});
		expect(logs.map((log) => log.request_id)).toEqual(["first", "second"]);
		expect(logs[0].request_duration_ms).toBe(2000);
	});
	it("refuses incomplete session results rather than showing a partial trace as complete", async () => {
		const session = vi.fn().mockResolvedValue(page([row("one")], { total: 2 }));
		await expect(loadCompleteSessionLogs({ type: "session_id", id: "session" }, {}, { session })).rejects.toThrow(
			"Session logs incomplete: loaded 1 of 2",
		);
	});
	it("supports the existing numbered-page response and sorts a stable deduplicated trace", async () => {
		const session = vi
			.fn()
			.mockResolvedValueOnce(page([row("b")], { total: 2, total_pages: 2 }))
			.mockResolvedValueOnce(page([row("a")], { total: 2, page: 2, total_pages: 2 }));
		const logs = await loadCompleteSessionLogs({ type: "session_id", id: "session" }, {}, { session });
		expect(session.mock.calls[1][1].page).toBe(2);
		expect(logs.map((log) => log.request_id)).toEqual(["b", "a"]);
	});
});
