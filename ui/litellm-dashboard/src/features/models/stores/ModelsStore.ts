import { computed, reactive } from "vue";
import { createRefreshScheduler } from "../../platform/logic/RefreshSchedulerLogic";
import { modelsApi, type ModelsApi } from "../api/ModelsApi";
import { transformModels } from "../logic/ModelDataLogic";
import type { ModelCatalog, ProxyModel } from "../support/ModelModels";

/** 冷却来自运行态而非配置；短轮询只负责发现新发生的失败，倒计时由共享时钟本地推进。 */
const AUTO_REFRESH_MS = 5_000;

interface LoadOptions {
	/** 后台刷新不显示加载态、不清空已有列表，避免冷却轮询让整页闪烁。 */
	background?: boolean;
}

export function createModelsStore(api: ModelsApi = modelsApi) {
	const state = reactive({
		rows: [] as ProxyModel[],
		total: 0,
		page: 1,
		size: 50,
		search: "",
		team: "personal",
		group: "all",
		accessGroup: "",
		viewMode: "current_team",
		sortBy: "",
		sortOrder: "asc" as "asc" | "desc",
		loading: false,
		error: "",
		expanded: [] as string[],
		widths: {} as Record<string, number>,
	});
	let generation = 0,
		disposed = false,
		controller: AbortController | null = null,
		timer: ReturnType<typeof setTimeout> | null = null,
		autoRefreshStarted = false;
	// 冷却轮询复用日志/额度页的调度器：请求在途不叠加，标签页隐藏时暂停，回到前台立即补刷。
	const scheduler = createRefreshScheduler(
		() => (state.loading || timer !== null ? Promise.resolve() : load({ background: true })),
		AUTO_REFRESH_MS,
	);
	async function load(options: LoadOptions = {}) {
		const current = ++generation;
		controller?.abort();
		controller = new AbortController();
		if (!options.background) state.loading = true;
		state.error = "";
		try {
			const result = await api.listModels(
				{
					page: state.page,
					size: state.size,
					search: state.search,
					teamId: state.team === "personal" ? undefined : state.team,
					sortBy: state.sortBy,
					sortOrder: state.sortBy ? state.sortOrder : undefined,
				},
				controller.signal,
			);
			if (disposed || current !== generation) return;
			state.rows = result.data;
			state.total = result.total_count || result.data.length;
		} catch (error) {
			if (
				!disposed &&
				current === generation &&
				!(error instanceof DOMException && error.name === "AbortError") &&
				(!options.background || state.rows.length === 0)
			)
				state.error = error instanceof Error ? error.message : "Failed to fetch models";
		} finally {
			if (!disposed && current === generation && !options.background) state.loading = false;
		}
	}
	function wakeAutoRefresh() {
		if (typeof document !== "undefined" && document.visibilityState === "visible") scheduler.wake();
	}
	function startAutoRefresh() {
		if (disposed || autoRefreshStarted) return;
		autoRefreshStarted = true;
		scheduler.start();
		if (typeof document !== "undefined") document.addEventListener("visibilitychange", wakeAutoRefresh);
	}
	function stopAutoRefresh() {
		autoRefreshStarted = false;
		scheduler.stop();
		if (typeof document !== "undefined") document.removeEventListener("visibilitychange", wakeAutoRefresh);
	}
	function search(value: string) {
		state.search = value;
		state.page = 1;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			void load();
		}, 200);
	}
	function page(value: number) {
		state.page = value;
		void load();
	}
	function team(value: string) {
		state.team = value || "personal";
		state.page = 1;
		void load();
	}
	function setSort(column: string, order: "asc" | "desc" | null) {
		state.sortBy = order
			? (({ input_cost: "costs", model_info_db_model: "status", created_by: "created_at" } as Record<string, string>)[column] ??
				column)
			: "";
		state.sortOrder = order ?? "asc";
		state.page = 1;
		void load();
	}
	function reset() {
		state.search = "";
		state.group = "all";
		state.accessGroup = "";
		state.team = "personal";
		state.viewMode = "current_team";
		state.page = 1;
		state.sortBy = "";
		state.sortOrder = "asc";
		if (timer) clearTimeout(timer);
		void load();
	}
	function displayed(catalog: ModelCatalog) {
		return computed(() =>
			transformModels(state.rows, catalog.costs).filter(
				(model) =>
					(state.group === "all" || state.group === "wildcard"
						? state.group !== "wildcard" || model.model_name.includes("*")
						: model.model_name === state.group) &&
					(!state.accessGroup || model.model_info.access_groups?.includes(state.accessGroup)),
			),
		);
	}
	function setColumnWidth(key: string, width: number) {
		// 0 表示恢复自适应列宽，不再用手动宽度覆盖这一列。
		if (!Number.isFinite(width) || width <= 0) delete state.widths[key];
		else state.widths[key] = Math.max(40, Math.min(500, width));
	}
	function toggleExpanded(id: string) {
		state.expanded = state.expanded.includes(id) ? state.expanded.filter((value) => value !== id) : [...state.expanded, id];
	}
	function clearFilters() {
		state.search = "";
		state.group = "all";
		state.accessGroup = "";
		state.page = 1;
		if (timer) clearTimeout(timer);
		void load();
	}
	function setView(value: string) {
		state.viewMode = value;
	}
	function resetPage() {
		if (state.page !== 1) {
			state.page = 1;
			void load();
		}
	}
	function setGroup(value: string) {
		state.group = value;
		resetPage();
	}
	function setAccessGroup(value: string) {
		state.accessGroup = value;
		resetPage();
	}
	function dispose() {
		disposed = true;
		generation++;
		controller?.abort();
		if (timer) clearTimeout(timer);
		stopAutoRefresh();
	}
	return {
		state,
		load,
		startAutoRefresh,
		stopAutoRefresh,
		search,
		page,
		team,
		setSort,
		reset,
		displayed,
		setColumnWidth,
		toggleExpanded,
		clearFilters,
		setView,
		setGroup,
		setAccessGroup,
		dispose,
	};
}
export type ModelsStore = ReturnType<typeof createModelsStore>;
