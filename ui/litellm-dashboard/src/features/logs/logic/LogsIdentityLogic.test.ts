import { describe, expect, it } from "vitest";
import { isInProgressLog, navigableSessionGroup, shareLogRows } from "./LogsIdentityLogic";
import type { LogsPage } from "../support/LogsModels";

describe("live log identity and session navigation", () => {
	it("preserves unchanged rows when live tail inserts a new request", () => {
		const first: LogsPage = {
			data: [{ request_id: "previous", startTime: "2026-11-07T02:00:00Z", metadata: { status: "success" } }],
			total: 1,
			page: 1,
			page_size: 100,
			total_pages: 1,
		};
		const next = shareLogRows(first, {
			...first,
			total: 2,
			data: [
				{ request_id: "new", startTime: "2026-11-07T03:00:00Z" },
				{ ...first.data[0], metadata: { status: "success" } },
			],
		});
		expect(next.data[1]).toBe(first.data[0]);
		expect(next.data[0].request_id).toBe("new");
	});
	it("applies a changed sort order even when every row value is unchanged", () => {
		const first: LogsPage = {
			data: [
				{ request_id: "a", startTime: "2026-11-07T02:00:00Z" },
				{ request_id: "b", startTime: "2026-11-07T03:00:00Z" },
			],
			total: 2,
			page: 1,
			page_size: 100,
			total_pages: 1,
		};
		expect(shareLogRows(first, { ...first, data: [first.data[1], first.data[0]] }).data.map((row) => row.request_id)).toEqual([
			"b",
			"a",
		]);
	});
	it("keeps an in-progress request out of the persisted session-detail path", () => {
		const log = { request_id: "active", startTime: "2026-11-07T02:00:00Z", session_id: "s", metadata: { status: "in_progress" } };
		expect(isInProgressLog(log)).toBe(true);
		expect(navigableSessionGroup(log)).toBeNull();
		expect(navigableSessionGroup({ ...log, metadata: { status: "success" } })).toEqual({ type: "session_id", id: "s" });
	});
});
