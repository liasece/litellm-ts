import { describe, expect, it, vi } from "vitest";
import { createPrivacyStore } from "./PrivacyStore";
import type {
	PrivacyApi,
	PrivacyListQuery,
	PrivacyOverview,
	PrivacyRequestRow,
	PrivacySettings,
	PrivacyValueRow,
} from "../support/PrivacyModels";

const overview: PrivacyOverview = {
	days: 7,
	summary: { occurrences: 3, distinctValues: 2, requests: 1, unresolved: 0 },
	byClient: [{ name: "codex", occurrences: 3, requests: 1 }],
	byProvider: [{ name: "OpenAI", occurrences: 3, requests: 1 }],
	byKind: [{ name: "EMAIL", occurrences: 3, values: 2 }],
	series: [],
};
const settings: PrivacySettings = {
	enabled: true,
	action: "mask",
	kinds: {},
	customWords: [],
	neverMask: [],
	maskConfiguredSecrets: true,
	failClosed: true,
	retentionDays: 30,
	rules: [],
	shape: true,
	providers: [],
	models: [],
};
const requestRow: PrivacyRequestRow = {
	requestId: "req-1",
	createdAt: "2026-01-01T00:00:00.000Z",
	client: "codex",
	provider: "OpenAI",
	model: "gpt-5",
	occurrences: 3,
	distinctValues: 1,
	kinds: { EMAIL: 3 },
	action: "mask",
	durationMs: 100,
	unresolved: 0,
};
const valueRow: PrivacyValueRow = {
	kind: "EMAIL",
	hash: "abcd1234",
	length: 12,
	hint: "a***",
	occurrences: 3,
	requests: 1,
	clients: ["codex"],
	lastSeen: "2026-01-01T00:00:00.000Z",
};

/**
 * 记录列表查询，其余接口返回固定快照。
 */
function makeApi(): { api: PrivacyApi; requestQueries: PrivacyListQuery[]; valueQueries: PrivacyListQuery[] } {
	const requestQueries: PrivacyListQuery[] = [];
	const valueQueries: PrivacyListQuery[] = [];
	const api: PrivacyApi = {
		overview: async () => overview,
		settings: async () => settings,
		requests: async (query) => {
			requestQueries.push(query);
			return { rows: [requestRow], hasMore: true };
		},
		values: async (query) => {
			valueQueries.push(query);
			return { rows: [valueRow], hasMore: true };
		},
		updateSettings: async () => settings,
	};
	return { api, requestQueries, valueQueries };
}

/**
 * 等待 store 的异步加载完成。
 * @param predicate - 完成条件
 */
async function waitFor(predicate: () => boolean): Promise<void> {
	await vi.waitFor(() => {
		if (!predicate()) throw new Error("not ready");
	});
}

describe("privacy list filtering and sorting", () => {
	it("筛选变化时从第一页重载并带上筛选条件", async () => {
		const { api, requestQueries } = makeApi();
		const store = createPrivacyStore(api);
		store.initialize();
		await waitFor(() => requestQueries.length === 1);
		await waitFor(() => !store.state.loading);
		expect(requestQueries[0]).toMatchObject({ days: 7, limit: 50, offset: 0, sort: "created", order: "desc" });

		await store.loadMore();
		expect(store.state.requests).toHaveLength(2);
		store.applyFilters([{ key: "client", label: "客户端", value: "codex", text: "Codex", match: "exact" }]);
		await waitFor(() => requestQueries.length === 3);

		expect(requestQueries[2]).toMatchObject({ offset: 0, client: "codex", sort: "created", order: "desc" });
		expect(store.state.requests).toHaveLength(1);
	});

	it("排序变化时从第一页重载并保留当前筛选", async () => {
		const { api, requestQueries } = makeApi();
		const store = createPrivacyStore(api);
		store.initialize();
		await waitFor(() => requestQueries.length === 1);
		store.applyFilters([{ key: "provider", label: "提供方", value: "OpenAI", text: "OpenAI", match: "exact" }]);
		await waitFor(() => requestQueries.length === 2);
		store.setSort({ key: "occurrences", order: "asc" });
		await waitFor(() => requestQueries.length === 3);

		expect(requestQueries[2]).toMatchObject({ offset: 0, provider: "OpenAI", sort: "occurrences", order: "asc" });
	});

	it("值列表使用独立筛选与默认排序", async () => {
		const { api, requestQueries, valueQueries } = makeApi();
		const store = createPrivacyStore(api);
		store.initialize();
		await waitFor(() => requestQueries.length === 1);
		store.setTab("values");
		await waitFor(() => valueQueries.length === 1);
		expect(valueQueries[0]).toMatchObject({ offset: 0, sort: "occurrences", order: "desc" });

		store.applyFilters([{ key: "kind", label: "类型", value: "EMAIL", text: "Email", match: "exact" }]);
		await waitFor(() => valueQueries.length === 2);
		expect(valueQueries[1]).toMatchObject({ offset: 0, kind: "EMAIL", sort: "occurrences", order: "desc" });
		expect(store.state.valueFilters).toHaveLength(1);
		expect(store.state.requestFilters).toHaveLength(0);
	});

	it("概览未返回时先加载列表，避免慢概览串行拖住表格", async () => {
		const { api } = makeApi();
		let resolveOverview: ((value: PrivacyOverview) => void) | undefined;
		let resolveRequest: ((value: { rows: PrivacyRequestRow[]; hasMore: boolean }) => void) | undefined;
		const slowApi: PrivacyApi = {
			...api,
			overview: () =>
				new Promise<PrivacyOverview>((resolve) => {
					resolveOverview = resolve;
				}),
			requests: () =>
				new Promise<{ rows: PrivacyRequestRow[]; hasMore: boolean }>((resolve) => {
					resolveRequest = resolve;
				}),
		};
		const store = createPrivacyStore(slowApi);
		store.initialize();
		await waitFor(() => resolveRequest !== undefined);
		resolveRequest?.({ rows: [requestRow], hasMore: false });
		await waitFor(() => store.state.requests.length === 1);
		expect(store.state.overview).toBeNull();
		resolveOverview?.(overview);
		await waitFor(() => store.state.overview !== null);
	});
});
