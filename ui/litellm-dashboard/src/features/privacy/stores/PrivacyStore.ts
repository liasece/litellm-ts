/** 脱敏页状态：区间切换、页签切换、分页与开关保存。 */
import { reactive } from "vue";
import { HttpApiError } from "../../platform/api/HttpApiClient";
import notificationManager from "../../notifications/logic/NotificationManager";
import { privacyApi } from "../api/PrivacyApi";
import { PRIVACY_PAGE_SIZE } from "../logic/PrivacyLogic";
import type { PrivacyApi, PrivacyOverview, PrivacyRequestRow, PrivacySettings, PrivacyValueRow } from "../support/PrivacyModels";

/**
 * 创建脱敏页 store。
 * @param api - 接口实现（测试可注入）
 */
export function createPrivacyStore(api: PrivacyApi = privacyApi) {
	const state = reactive({
		rangeDays: 7,
		tab: "requests",
		overview: null as PrivacyOverview | null,
		requests: [] as PrivacyRequestRow[],
		values: [] as PrivacyValueRow[],
		requestsExhausted: false,
		valuesExhausted: false,
		settings: null as PrivacySettings | null,
		loading: true,
		loadingMore: false,
		saving: false,
		error: null as Error | null,
	});
	let generation = 0;
	let disposed = false;
	let controller: AbortController | null = null;

	/**
	 * 取当前页签的数据。
	 */
	function activeRows(): number {
		return state.tab === "requests" ? state.requests.length : state.values.length;
	}

	/**
	 * 是否还有更多。
	 */
	function exhausted(): boolean {
		return state.tab === "requests" ? state.requestsExhausted : state.valuesExhausted;
	}

	/**
	 * 记录错误。
	 * @param error - 原始错误
	 */
	function fail(error: unknown): void {
		if (error instanceof HttpApiError) {
			notificationManager.fromBackend(error.message);
		}
		state.error = error instanceof Error ? error : new Error(String(error));
		state.loading = false;
		state.loadingMore = false;
	}

	/**
	 * 拉取概览与当前页签的首页数据。
	 */
	async function load(): Promise<void> {
		const current = ++generation;
		controller?.abort();
		const request = new AbortController();
		controller = request;
		state.loading = state.overview === null;
		state.error = null;
		try {
			const [overview, settings] = await Promise.all([api.overview(state.rangeDays, request.signal), api.settings(request.signal)]);
			if (disposed || current !== generation) return;
			state.overview = overview;
			state.settings = settings;
			if (state.tab === "requests") {
				const page = await api.requests({ days: state.rangeDays, limit: PRIVACY_PAGE_SIZE, offset: 0 }, request.signal);
				if (disposed || current !== generation) return;
				state.requests = [...page.rows];
				state.requestsExhausted = !page.hasMore;
			} else {
				const page = await api.values({ days: state.rangeDays, limit: PRIVACY_PAGE_SIZE, offset: 0 }, request.signal);
				if (disposed || current !== generation) return;
				state.values = [...page.rows];
				state.valuesExhausted = !page.hasMore;
			}
			state.loading = false;
		} catch (error: unknown) {
			if (disposed || current !== generation || request.signal.aborted) return;
			fail(error);
		} finally {
			if (controller === request) controller = null;
		}
	}

	/**
	 * 追加下一页。
	 */
	async function loadMore(): Promise<void> {
		if (state.loading || state.loadingMore || exhausted()) return;
		const current = generation;
		state.loadingMore = true;
		try {
			const offset = activeRows();
			if (state.tab === "requests") {
				const page = await api.requests({ days: state.rangeDays, limit: PRIVACY_PAGE_SIZE, offset: offset });
				if (disposed || current !== generation) return;
				state.requests = [...state.requests, ...page.rows];
				state.requestsExhausted = !page.hasMore;
			} else {
				const page = await api.values({ days: state.rangeDays, limit: PRIVACY_PAGE_SIZE, offset: offset });
				if (disposed || current !== generation) return;
				state.values = [...state.values, ...page.rows];
				state.valuesExhausted = !page.hasMore;
			}
		} catch (error: unknown) {
			if (disposed || current !== generation) return;
			fail(error);
		} finally {
			if (!disposed && current === generation) state.loadingMore = false;
		}
	}

	/**
	 * 切换统计区间。
	 * @param days - 天数
	 */
	function setRange(days: number): void {
		if (state.rangeDays === days) return;
		state.rangeDays = days;
		state.requests = [];
		state.values = [];
		state.requestsExhausted = false;
		state.valuesExhausted = false;
		void load();
	}

	/**
	 * 切换明细页签。
	 * @param key - 页签键
	 */
	function setTab(key: string): void {
		if (state.tab === key) return;
		state.tab = key;
		const empty = key === "requests" ? state.requests.length === 0 : state.values.length === 0;
		if (empty) void load();
	}

	/**
	 * 打开或关闭脱敏。
	 * @param enabled - 是否开启
	 */
	async function setEnabled(enabled: boolean): Promise<void> {
		if (state.saving || state.settings === null || state.settings.enabled === enabled) return;
		const previous = state.settings;
		state.saving = true;
		try {
			const settings = await api.updateSettings({ enabled: enabled });
			if (disposed) return;
			state.settings = settings;
		} catch (error: unknown) {
			if (disposed) return;
			if (error instanceof HttpApiError) {
				notificationManager.fromBackend(error.message);
			}
			state.settings = previous;
			state.error = error instanceof Error ? error : new Error(String(error));
		} finally {
			if (!disposed) state.saving = false;
		}
	}

	/**
	 * 组件挂载时调用。
	 */
	function initialize(): void {
		if (disposed) return;
		void load();
	}

	/**
	 * 组件卸载时调用。
	 */
	function dispose(): void {
		disposed = true;
		generation++;
		controller?.abort();
	}

	return { state, initialize, dispose, load, loadMore, setRange, setTab, setEnabled };
}
