import { describe, expect, it } from "vitest";
import { type LogsPage, shareLogsPageIdentity } from "./logsStructuralSharing";

type Entry = { request_id: string; status: string; spend: number };

const entry = (requestId: string, overrides: Partial<Entry> = {}): Entry => ({
	request_id: requestId,
	status: "Success",
	spend: 0,
	...overrides,
});

const page = (data: Entry[], overrides: Partial<LogsPage<Entry>> = {}): LogsPage<Entry> => ({
	data,
	total: 100,
	page: 1,
	page_size: 100,
	total_pages: 1,
	...overrides,
});

describe("shareLogsPageIdentity", () => {
	it("keeps the previous page object when a poll returns the same rows", () => {
		const first = page([entry("a"), entry("b")]);

		expect(shareLogsPageIdentity(first, page([entry("a"), entry("b")]))).toBe(first);
	});

	it("keeps unchanged rows when live tail prepends a new log", () => {
		const oldest = entry("a");
		const middle = entry("b");
		const first = page([oldest, middle]);

		const next = shareLogsPageIdentity(first, page([entry("c"), entry("a"), entry("b")]));

		expect(next).not.toBe(first);
		expect(next.data.map((row) => row.request_id)).toEqual(["c", "a", "b"]);
		expect(next.data[1]).toBe(oldest);
		expect(next.data[2]).toBe(middle);
	});

	it("replaces only the row whose content changed", () => {
		const finished = entry("a");
		const running = entry("b");
		const first = page([finished, running]);

		const next = shareLogsPageIdentity(first, page([entry("a", { status: "In Progress" }), entry("b")]));

		expect(next.data[0]).not.toBe(finished);
		expect(next.data[0].status).toBe("In Progress");
		expect(next.data[1]).toBe(running);
	});

	it("keeps row identity when only the paging totals change", () => {
		const row = entry("a");
		const first = page([row]);

		const next = shareLogsPageIdentity(first, page([entry("a")], { total: 101 }));

		expect(next).not.toBe(first);
		expect(next.total).toBe(101);
		expect(next.data[0]).toBe(row);
	});
});
