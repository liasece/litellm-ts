import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogsListStore } from "./LogsListStore";
import type { LogsPage } from "../support/LogsModels";

const emptyPage = (): LogsPage => ({ data: [], page: 1, page_size: 100, total: 0, total_pages: 0 });
type ListRequest = (query: URLSearchParams, signal?: AbortSignal) => Promise<LogsPage>;
const tick = async () => {
	await Promise.resolve();
	await Promise.resolve();
};
afterEach(() => {
	vi.useRealTimers();
});

describe("request log browsing", () => {
	it("queries alias/error/request filters on the server once with the requested page and sort", async () => {
		vi.useFakeTimers();
		const list = vi.fn<ListRequest>(async () => emptyPage());
		const store = createLogsListStore({
			scope: () => ({ userId: "admin", role: "Admin" }),
			api: { list },
			socket: () => () => undefined,
			search: "page=logs&key_alias=Research+key&error_code=429&logs_page=3&logs_page_size=500&logs_sort_by=spend&logs_sort_order=asc",
		});
		store.start();
		await tick();
		expect(list).toHaveBeenCalledTimes(1);
		const query = list.mock.calls[0][0] as URLSearchParams;
		expect(query.get("key_alias")).toBe("Research key");
		expect(query.get("error_code")).toBe("429");
		expect(query.get("page")).toBe("3");
		expect(query.get("page_size")).toBe("500");
		expect(query.get("sort_by")).toBe("spend");
		expect(query.get("sort_order")).toBe("asc");
		expect(query.get("include_active")).toBe("true");
		store.dispose();
	});
	it("debounces a request ID search and rejects a late response from the previous view", async () => {
		vi.useFakeTimers();
		const resolvers: Array<(page: LogsPage) => void> = [];
		const list = vi.fn<ListRequest>(() => new Promise<LogsPage>((resolve) => resolvers.push(resolve)));
		const store = createLogsListStore({
			scope: () => ({ userId: "admin", role: "Admin" }),
			api: { list },
			socket: () => () => undefined,
		});
		store.start();
		store.applyFilters({ "Request ID": "old" });
		store.applyFilters({ "Request ID": "wanted-request" });
		await vi.advanceTimersByTimeAsync(299);
		expect(list).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(list).toHaveBeenCalledTimes(2);
		expect(list.mock.calls[1][0].get("request_id")).toBe("wanted-request");
		resolvers[1]({
			...emptyPage(),
			data: [{ request_id: "wanted-request", startTime: "2026-11-07T02:00:00Z" }],
			total: 1,
			total_pages: 1,
		});
		await tick();
		resolvers[0]({ ...emptyPage(), data: [{ request_id: "old", startTime: "2026-11-07T01:00:00Z" }], total: 1, total_pages: 1 });
		await tick();
		expect(store.page.value.data.map((row) => row.request_id)).toEqual(["wanted-request"]);
		store.dispose();
	});
	it("keeps internal-user requests scoped and clears view filters without losing their identity scope", async () => {
		vi.useFakeTimers();
		const list = vi.fn<ListRequest>(async () => emptyPage());
		const writeUrl = vi.fn();
		const store = createLogsListStore({
			scope: () => ({ userId: "researcher", role: "Internal User" }),
			api: { list },
			socket: () => () => undefined,
			search: "page=logs&key_alias=old&logs_page=4&tab=aliases",
			writeUrl,
		});
		store.start();
		await tick();
		expect(list.mock.calls[0][0].get("user_id")).toBe("researcher");
		store.resetFilters();
		await vi.advanceTimersByTimeAsync(0);
		const query = list.mock.calls.at(-1)![0];
		expect(query.get("user_id")).toBe("researcher");
		expect(query.get("key_alias")).toBeNull();
		expect(query.get("page")).toBe("1");
		expect(writeUrl.mock.calls.at(-1)![0].toString()).toBe("page=logs");
		store.dispose();
	});
	it("clears header filters without changing the selected time range", async () => {
		vi.useFakeTimers();
		const list = vi.fn<ListRequest>(async () => emptyPage());
		const store = createLogsListStore({
			scope: () => ({ userId: "admin", role: "Admin" }),
			api: { list },
			socket: () => () => undefined,
			search: "page=logs&team_id=team-1&status_filter=failure&logs_time_value=7&logs_time_unit=days",
		});
		store.start();
		await tick();
		store.clearFilters();
		await vi.advanceTimersByTimeAsync(300);
		const query = list.mock.calls.at(-1)![0];
		expect(query.get("team_id")).toBeNull();
		expect(query.get("status_filter")).toBeNull();
		expect(store.state.filters["Team ID"]).toBe("");
		expect(store.state.selectedTimeInterval).toEqual({ value: 7, unit: "days" });
		store.dispose();
	});

	it("stops list requests and live notifications when another log tab is selected", async () => {
		vi.useFakeTimers();
		const close = vi.fn();
		const list = vi.fn<ListRequest>(async () => emptyPage());
		const store = createLogsListStore({ scope: () => ({ userId: "admin", role: "Admin" }), api: { list }, socket: () => close });
		store.start();
		await tick();
		store.setTab("audit logs");
		expect(close).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(list).toHaveBeenCalledTimes(1);
		store.dispose();
	});
});
