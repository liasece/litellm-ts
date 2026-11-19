import { describe, expect, it, vi } from "vitest";
import { emptyMetrics } from "../logic/UsageSummaryLogic";
import { createUsageOverviewStore } from "./UsageOverviewStore";
import type {
	DailyActivityResponse,
	UsageDetailResponse,
	UsageInsightsApi,
	UsageQuery,
	UsageSummaryResponse,
} from "../support/UsageModels";

const query: UsageQuery = { entity: "global", from: new Date(2026, 10, 1), to: new Date(2026, 10, 7), selected: [] };
const metrics = { ...emptyMetrics(), spend: 2, api_requests: 1, total_tokens: 5 };

function summary(): UsageSummaryResponse {
	const dimensions = { models: [], model_groups: [], providers: [], api_keys: [], mcp_servers: [], endpoints: [], entities: [] };
	return {
		view: "summary",
		results: [{ date: "2026-11-01", metrics }],
		dimensions: { ...dimensions, models: [{ key: "model-a", metrics }] },
		metadata: {
			total_spend: 2,
			total_prompt_tokens: 0,
			total_completion_tokens: 0,
			total_tokens: 5,
			total_api_requests: 1,
			total_successful_requests: 1,
			total_failed_requests: 0,
			total_cache_read_input_tokens: 0,
			total_cache_creation_input_tokens: 0,
			total_pages: 1,
			has_more: false,
			page: 1,
		},
	};
}

function detail(page: number, hasMore = page === 1, totalPages = 2): UsageDetailResponse {
	return {
		view: "models",
		results: [{ date: "2026-11-01", metrics }],
		items: [
			{
				key: "model-" + page,
				metrics,
				daily: [{ date: "2026-11-01", metrics }],
				top_api_keys: [{ key: "key-" + page, metrics }],
			},
		],
		metadata: { ...summary().metadata, page, total_pages: totalPages, has_more: hasMore, total_count: totalPages },
	};
}

describe("UsageOverviewStore", () => {
	it("loads summary and appends detail pages", async () => {
		const api: UsageInsightsApi = {
			summary: vi.fn().mockResolvedValue(summary()),
			detail: vi.fn().mockResolvedValueOnce(detail(1)).mockResolvedValueOnce(detail(2)),
			full: vi.fn(),
		};
		const store = createUsageOverviewStore(api);
		await store.loadSummary(query);
		expect(store.state.summary?.dimensions.models[0].key).toBe("model-a");
		await store.loadDetail(query, "models", 1);
		expect(store.state.details.models?.items).toHaveLength(1);
		await store.loadDetail(query, "models", 2, true);
		expect(store.state.details.models?.items.map((item) => item.key)).toEqual(["model-1", "model-2"]);
		expect(store.state.details.models?.metadata.has_more).toBe(false);
		store.reset();
	});
	it("loads every detail page so the chart covers entities beyond the first spend page", async () => {
		const api: UsageInsightsApi = {
			summary: vi.fn().mockResolvedValue(summary()),
			detail: vi
				.fn()
				.mockResolvedValueOnce(detail(1, true, 3))
				.mockResolvedValueOnce(detail(2, true, 3))
				.mockResolvedValueOnce(detail(3, false, 3)),
			full: vi.fn(),
		};
		const store = createUsageOverviewStore(api);
		const loaded = await store.loadCompleteDetail(query, "models");
		expect(api.detail).toHaveBeenCalledTimes(3);
		expect(store.state.details.models?.items.map((item) => item.key)).toEqual(["model-1", "model-2", "model-3"]);
		expect(loaded?.metadata.has_more).toBe(false);
		store.reset();
	});
	it("ignores an obsolete summary response after a newer filter", async () => {
		let resolveOld!: (value: UsageSummaryResponse) => void;
		const api: UsageInsightsApi = {
			summary: vi
				.fn()
				.mockImplementationOnce(() => new Promise<UsageSummaryResponse>((resolve) => (resolveOld = resolve)))
				.mockResolvedValue({ ...summary(), metadata: { ...summary().metadata, total_spend: 99 } }),
			detail: vi.fn(),
			full: vi.fn(),
		};
		const store = createUsageOverviewStore(api);
		const old = store.loadSummary(query);
		await store.loadSummary({ ...query, selected: ["user-2"] });
		resolveOld(summary());
		await old;
		expect(store.state.summary?.metadata.total_spend).toBe(99);
		store.reset();
	});
	it("aborts an in-flight full export when the summary is reloaded", async () => {
		let aborted!: () => void;
		let signal: AbortSignal | undefined;
		const api: UsageInsightsApi = {
			summary: vi.fn().mockResolvedValue(summary()),
			detail: vi.fn(),
			full: vi.fn().mockImplementation((_query, requestSignal) => {
				signal = requestSignal;
				return new Promise<DailyActivityResponse>((_resolve, reject) => {
					aborted = () => reject(new Error("aborted"));
					requestSignal?.addEventListener("abort", aborted, { once: true });
				});
			}),
		};
		const store = createUsageOverviewStore(api);
		const pending = store.loadFull(query);
		await store.loadSummary(query);
		await expect(pending).resolves.toBeNull();
		expect(signal?.aborted).toBe(true);
		expect(store.state.fullLoading).toBe(false);
		store.reset();
		aborted();
	});
	it("keeps full export data separate from summary", async () => {
		const full = { results: [], metadata: summary().metadata } as DailyActivityResponse;
		const api: UsageInsightsApi = {
			summary: vi.fn().mockResolvedValue(summary()),
			detail: vi.fn(),
			full: vi.fn().mockResolvedValue(full),
		};
		const store = createUsageOverviewStore(api);
		await store.loadSummary(query);
		await expect(store.loadFull(query)).resolves.toBe(full);
		expect(store.state.summary?.dimensions.models).toHaveLength(1);
		expect(store.state.fullLoading).toBe(false);
		store.reset();
	});
});
