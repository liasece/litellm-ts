import { describe, expect, it, vi } from "vitest";
import { legacyUsageApi } from "../api/LegacyUsageApi";
import type { LegacyRow } from "../api/LegacyUsageApi";
import { createLegacyUsageStore } from "./LegacyUsageStore";
const now = () => new Date(2026, 10, 7, 12);
const range = { from: new Date(2026, 10, 1), to: new Date(2026, 10, 7) };
function api() {
	return {
		settings: vi.fn<typeof legacyUsageApi.settings>(async () => ({})),
		spend: vi.fn<typeof legacyUsageApi.spend>(async () => [{ date: new Date(2026, 10, 2).toISOString().split("T")[0], spend: 1.236 }]),
		topKeys: vi.fn<typeof legacyUsageApi.topKeys>(async () => [{ api_key: "hash-1", key_alias: "research", total_spend: 1.236 }]),
		topModels: vi.fn<typeof legacyUsageApi.topModels>(async () => [{ model: "gpt-4.1", total_spend: 1.236 }]),
		providers: vi.fn<typeof legacyUsageApi.providers>(async () => [{ provider: "openai", spend: 1.236 }]),
		activity: vi.fn<typeof legacyUsageApi.activity>(async () => ({
			sum_api_requests: 3,
			daily_data: [{ date: new Date(2026, 10, 2).toISOString().split("T")[0], api_requests: 3, total_tokens: 12 }],
		})),
		modelActivity: vi.fn<typeof legacyUsageApi.modelActivity>(async () => []),
		teams: vi.fn<typeof legacyUsageApi.teams>(async () => ({
			teams: ["Research"],
			daily_spend: [],
			total_spend_per_team: [{ team_id: "Research", total_spend: 1.236 }],
		})),
		tagNames: vi.fn<typeof legacyUsageApi.tagNames>(async () => ["research"]),
		tags: vi.fn<typeof legacyUsageApi.tags>(async () => [{ name: "research", spend: 1.236 }]),
		endUsers: vi.fn<typeof legacyUsageApi.endUsers>(async () => [{ end_user: "customer", total_spend: 1.236 }]),
	};
}
describe("legacy Usage observable data contracts", () => {
	it("stops every expensive query when the server query limit is active", async () => {
		const backend = api();
		backend.settings.mockResolvedValue({ DISABLE_EXPENSIVE_DB_QUERIES: true, NUM_SPEND_LOGS_ROWS: 1000001 });
		const store = createLegacyUsageStore("Admin", backend, now);
		await store.initialize(range);
		await store.tags(range, ["research"]);
		expect(store.state.settings.NUM_SPEND_LOGS_ROWS).toBe(1000001);
		for (const [name, request] of Object.entries(backend)) if (name !== "settings") expect(request).not.toHaveBeenCalled();
	});
	it("fills the whole current month while preserving the received spend, rankings and activity", async () => {
		const backend = api(),
			store = createLegacyUsageStore("Admin Viewer", backend, now);
		await store.initialize(range);
		expect(store.state.spend).toHaveLength(30);
		expect(store.state.monthlySpend).toBe(1.24);
		expect(store.state.spend[0]).toMatchObject({ api_requests: 0, total_tokens: 0 });
		expect(store.state.topKeys).toEqual([{ api_key: "hash-1", key_alias: "research", spend: 1.236, tags: [] }]);
		const daily = store.state.activity.daily_data as LegacyRow[];
		expect(daily).toHaveLength(30);
		expect(daily[1]).toMatchObject({ api_requests: 3, total_tokens: 12 });
		expect(store.state.teams[0]).toMatchObject({ Research: 0 });
		expect(backend.providers).toHaveBeenCalledWith("2026-11-01", "2026-11-30");
		expect(backend.tags).toHaveBeenCalledWith(range.from, range.to);
		expect(backend.endUsers).toHaveBeenCalledWith(null, undefined, undefined);
	});
	it("keeps only All Up queries for an internal user and isolates a failed dataset", async () => {
		const backend = api();
		backend.topKeys.mockRejectedValue(new Error("synthetic unavailable"));
		const store = createLegacyUsageStore("Internal User", backend, now);
		await store.initialize(range);
		expect(store.state.monthlySpend).toBe(1.24);
		expect(store.state.topKeys).toEqual([]);
		for (const request of [backend.teams, backend.tagNames, backend.tags, backend.endUsers]) expect(request).not.toHaveBeenCalled();
	});
	it("starts other queries even when the initial settings request fails", async () => {
		const backend = api();
		backend.settings.mockRejectedValue(new Error("synthetic unavailable"));
		const store = createLegacyUsageStore("Admin", backend, now);
		await store.initialize(range);
		expect(backend.spend).toHaveBeenCalledOnce();
		expect(store.state.endUsers).toHaveLength(1);
	});
	it("forwards a selected key, date range and tag selection without changing the legacy wire scope", async () => {
		const backend = api(),
			store = createLegacyUsageStore("Admin", backend, now);
		await store.endUsers("hash-1", range);
		await store.tags(range, ["research"]);
		expect(backend.endUsers).toHaveBeenCalledWith("hash-1", range.from, range.to);
		expect(backend.tags).toHaveBeenCalledWith(range.from, range.to, ["research"]);
		await store.tags(range, []);
		expect(backend.tags).toHaveBeenLastCalledWith(range.from, range.to, undefined);
	});
	it("does not publish an in-flight response after leaving the page", async () => {
		const backend = api();
		let resolve!: (value: LegacyRow[]) => void;
		backend.spend.mockImplementation(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const store = createLegacyUsageStore("Admin", backend, now),
			request = store.initialize(range);
		await Promise.resolve();
		store.dispose();
		resolve([{ date: "2026-11-02", spend: 99 }]);
		await request;
		expect(store.state.monthlySpend).toBe(0);
		expect(store.state.spend).toEqual([]);
	});
});
