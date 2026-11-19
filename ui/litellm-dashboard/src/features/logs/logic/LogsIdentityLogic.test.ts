import { describe, expect, it } from "vitest";
import { isInProgressLog, navigableSessionGroup, shareLogRows, uniqueLogRows } from "./LogsIdentityLogic";
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
	it("collapses a request that the page reports twice and keeps the settled row", () => {
		const page: LogsPage = {
			data: [
				{ request_id: "dup", startTime: "2026-11-07T02:00:00Z", status: "in_progress" },
				{ request_id: "dup", startTime: "2026-11-07T02:00:00Z", status: "success", spend: 0.2 },
				{ request_id: "other", startTime: "2026-11-07T03:00:00Z" },
			],
			total: 3,
			page: 1,
			page_size: 100,
			total_pages: 1,
		};
		const unique = uniqueLogRows(page);
		expect(unique.data.map((row) => [row.request_id, row.status])).toEqual([
			["dup", "success"],
			["other", undefined],
		]);
		expect(unique.total).toBe(3);
		expect(uniqueLogRows(unique)).toBe(unique);
	});
	it("never aliases two rows of a duplicated request while sharing identities", () => {
		const first: LogsPage = {
			data: [{ request_id: "dup", startTime: "2026-11-07T02:00:00Z", status: "in_progress" }],
			total: 1,
			page: 1,
			page_size: 100,
			total_pages: 1,
		};
		const next = shareLogRows(first, {
			...first,
			data: [
				{ request_id: "dup", startTime: "2026-11-07T02:00:00Z", status: "in_progress" },
				{ request_id: "dup", startTime: "2026-11-07T02:00:00Z", status: "success", spend: 0.2 },
			],
		});
		expect(next.data).toHaveLength(1);
		expect(next.data[0].status).toBe("success");
	});
	it("keeps an in-progress request out of the persisted session-detail path", () => {
		const log = { request_id: "active", startTime: "2026-11-07T02:00:00Z", session_id: "s", metadata: { status: "in_progress" } };
		expect(isInProgressLog(log)).toBe(true);
		expect(navigableSessionGroup(log)).toBeNull();
		expect(navigableSessionGroup({ ...log, metadata: { status: "success" } })).toEqual({ type: "session_id", id: "s" });
	});
});
