import { afterEach, describe, expect, it, vi } from "vitest";
import { createDailyActivityStore, emptyDailyActivity } from "./DailyActivityStore";
import type { DailyActivityResponse, UsageQuery } from "../support/UsageModels";
const query: UsageQuery = { entity: "global", from: new Date(2026, 10, 1), to: new Date(2026, 10, 7), selected: [] };
function page(n: number, total = 1): DailyActivityResponse {
	const data = emptyDailyActivity();
	data.results = [
		{
			date: "2026-11-" + String(n).padStart(2, "0"),
			metrics: {
				spend: n,
				prompt_tokens: 0,
				completion_tokens: 0,
				total_tokens: n * 10,
				api_requests: 1,
				successful_requests: 1,
				failed_requests: 0,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			},
			breakdown: { models: {}, model_groups: {}, api_keys: {}, providers: {}, mcp_servers: {}, entities: {}, endpoints: {} },
		},
	];
	data.metadata = { ...data.metadata, total_spend: n, total_tokens: n * 10, total_pages: total, has_more: n < total, page: n };
	return data;
}
afterEach(() => vi.useRealTimers());
describe("progressive daily activity ownership", () => {
	it("uses the aggregate without fetching pages", async () => {
		const api = { aggregated: vi.fn().mockResolvedValue(page(7)), page: vi.fn() };
		const store = createDailyActivityStore(api);
		await store.load(query);
		expect(store.state.data.metadata.total_spend).toBe(7);
		expect(api.page).not.toHaveBeenCalled();
		expect(store.state.loading).toBe(false);
		store.dispose();
	});
	it("falls back and publishes the first page, then batches pages 2–4 with summed cost and token totals", async () => {
		vi.useFakeTimers();
		const api = { aggregated: vi.fn().mockRejectedValue(new Error("unsupported")), page: vi.fn(async (_q, p: number) => page(p, 5)) };
		const store = createDailyActivityStore(api),
			loading = store.load(query);
		await vi.advanceTimersByTimeAsync(0);
		expect(store.state.data.results).toHaveLength(1);
		expect(store.state.isFetchingMore).toBe(true);
		await vi.advanceTimersByTimeAsync(600);
		expect(api.page).toHaveBeenCalledTimes(3);
		expect(store.state.data.results).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(300);
		expect(store.state.data.results).toHaveLength(4);
		expect(store.state.progress.currentPage).toBe(4);
		expect(store.state.data.metadata.total_spend).toBe(10);
		await vi.advanceTimersByTimeAsync(300);
		await loading;
		expect(store.state.data.results).toHaveLength(5);
		expect(store.state.data.metadata.total_spend).toBe(15);
		expect(store.state.data.metadata.total_tokens).toBe(150);
		expect(store.state.isFetchingMore).toBe(false);
		expect(store.state.data.metadata.has_more).toBe(false);
		store.dispose();
	});
	it("Stop resolves the waiting load, retains published partial data and prevents further HTTP", async () => {
		vi.useFakeTimers();
		const api = { aggregated: vi.fn(), page: vi.fn(async (_q, p: number) => page(p, 10)) };
		const store = createDailyActivityStore(api),
			loading = store.load({ ...query, entity: "team" }, false);
		await vi.advanceTimersByTimeAsync(0);
		store.cancel();
		await loading;
		await vi.advanceTimersByTimeAsync(3000);
		expect(api.page).toHaveBeenCalledTimes(1);
		expect(store.state.data.results).toHaveLength(1);
		expect(store.state.cancelled).toBe(true);
		expect(store.state.isFetchingMore).toBe(false);
		store.dispose();
	});
	it("an obsolete aggregate cannot overwrite a new user filter even if the transport ignores abort", async () => {
		let resolveOld!: (data: DailyActivityResponse) => void;
		const api = {
			aggregated: vi
				.fn()
				.mockImplementationOnce(() => new Promise<DailyActivityResponse>((resolve) => (resolveOld = resolve)))
				.mockResolvedValue(page(2)),
			page: vi.fn(),
		};
		const store = createDailyActivityStore(api),
			old = store.load(query);
		await store.load({ ...query, selected: ["new-user"] });
		resolveOld(page(99));
		await old;
		expect(store.state.data.metadata.total_spend).toBe(2);
		store.dispose();
	});
	it("dispose aborts an in-flight page and suppresses updates", async () => {
		let signal: AbortSignal | undefined, resolve!: (data: DailyActivityResponse) => void;
		const api = {
			aggregated: vi.fn(),
			page: vi.fn((_q, _p, s?: AbortSignal) => {
				signal = s;
				return new Promise<DailyActivityResponse>((r) => (resolve = r));
			}),
		};
		const store = createDailyActivityStore(api),
			loading = store.load({ ...query, entity: "tag" }, false);
		store.dispose();
		expect(signal?.aborted).toBe(true);
		resolve(page(1));
		await loading;
		expect(store.state.data.results).toEqual([]);
	});
});
