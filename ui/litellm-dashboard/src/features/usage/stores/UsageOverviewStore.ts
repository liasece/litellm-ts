import { shallowReactive } from "vue";
import { dailyActivityApi } from "../api/DailyActivityApi";
import type {
	DailyActivityResponse,
	UsageDetailResponse,
	UsageDetailView,
	UsageInsightsApi,
	UsageQuery,
	UsageSummaryResponse,
} from "../support/UsageModels";

interface UsageOverviewState {
	summary: UsageSummaryResponse | null;
	details: Partial<Record<UsageDetailView, UsageDetailResponse>>;
	loading: boolean;
	detailLoading: Partial<Record<UsageDetailView, boolean>>;
	error: string | null;
	fullLoading: boolean;
	fullError: string | null;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : "Failed to load usage data";
}

/**
 * Global Usage 页的按需加载状态。
 *
 * summary 与 detail 分开持有，避免日期/维度切换时把整份 breakdown 重新放进 Vue 深层响应式；
 * 旧实体页仍使用 DailyActivityStore 的分页/full 路径。
 */
export function createUsageOverviewStore(api: UsageInsightsApi = dailyActivityApi) {
	const state = shallowReactive<UsageOverviewState>({
		summary: null,
		details: {},
		loading: false,
		detailLoading: {},
		error: null,
		fullLoading: false,
		fullError: null,
	});
	let generation = 0;
	let summaryController: AbortController | null = null;
	const detailControllers = new Map<UsageDetailView, AbortController>();
	let fullController: AbortController | null = null;

	function abortDetails() {
		for (const controller of detailControllers.values()) controller.abort();
		detailControllers.clear();
	}

	async function loadSummary(query: UsageQuery) {
		generation += 1;
		const current = generation;
		summaryController?.abort();
		summaryController = new AbortController();
		fullController?.abort();
		fullController = null;
		state.fullLoading = false;
		state.fullError = null;
		abortDetails();
		state.loading = true;
		state.error = null;
		state.summary = null;
		state.details = {};
		state.detailLoading = {};
		try {
			const summary = await api.summary(query, summaryController.signal);
			if (current === generation) state.summary = summary;
		} catch (error: unknown) {
			if (current === generation && !summaryController.signal.aborted) state.error = messageOf(error);
		} finally {
			if (current === generation) state.loading = false;
		}
	}

	async function loadDetail(query: UsageQuery, view: UsageDetailView, page = 1, append = false) {
		const current = generation;
		detailControllers.get(view)?.abort();
		const controller = new AbortController();
		detailControllers.set(view, controller);
		state.detailLoading = { ...state.detailLoading, [view]: true };
		try {
			const detail = await api.detail(query, view, page, controller.signal);
			if (current !== generation || controller.signal.aborted) return;
			const previous = append ? state.details[view] : null;
			state.details = {
				...state.details,
				[view]: previous
					? {
							...detail,
							items: [...previous.items, ...detail.items],
							metadata: detail.metadata,
						}
					: detail,
			};
		} catch (error: unknown) {
			if (current === generation && !controller.signal.aborted) state.error = messageOf(error);
		} finally {
			if (current === generation && detailControllers.get(view) === controller) {
				state.detailLoading = { ...state.detailLoading, [view]: false };
			}
		}
	}

	async function loadFull(query: UsageQuery): Promise<DailyActivityResponse | null> {
		fullController?.abort();
		const controller = new AbortController();
		fullController = controller;
		state.fullLoading = true;
		state.fullError = null;
		try {
			return await api.full(query, controller.signal);
		} catch (error: unknown) {
			if (!controller.signal.aborted) state.fullError = messageOf(error);
			return null;
		} finally {
			if (!controller.signal.aborted) state.fullLoading = false;
		}
	}

	function reset() {
		generation += 1;
		summaryController?.abort();
		summaryController = null;
		abortDetails();
		fullController?.abort();
		fullController = null;
		state.summary = null;
		state.details = {};
		state.loading = false;
		state.detailLoading = {};
		state.error = null;
		state.fullLoading = false;
		state.fullError = null;
	}

	return { state, loadSummary, loadDetail, loadFull, reset };
}
