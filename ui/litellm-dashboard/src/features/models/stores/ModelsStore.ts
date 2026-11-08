import { computed, reactive } from "vue";
import { modelsApi, type ModelsApi } from "../api/ModelsApi";
import { transformModels } from "../logic/ModelDataLogic";
import type { ModelCatalog, ProxyModel } from "../support/ModelModels";
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
		filtersOpen: false,
		expanded: [] as string[],
		widths: {} as Record<string, number>,
	});
	let generation = 0,
		disposed = false,
		controller: AbortController | null = null,
		timer: ReturnType<typeof setTimeout> | null = null;
	async function load() {
		const current = ++generation;
		controller?.abort();
		controller = new AbortController();
		state.loading = true;
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
			if (!disposed && current === generation && !(error instanceof DOMException && error.name === "AbortError"))
				state.error = error instanceof Error ? error.message : "Failed to fetch models";
		} finally {
			if (!disposed && current === generation) state.loading = false;
		}
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
		state.widths[key] = Math.max(40, Math.min(500, width));
	}
	function toggleExpanded(id: string) {
		state.expanded = state.expanded.includes(id) ? state.expanded.filter((value) => value !== id) : [...state.expanded, id];
	}
	function toggleFilters() {
		state.filtersOpen = !state.filtersOpen;
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
	}
	return {
		state,
		load,
		search,
		page,
		team,
		setSort,
		reset,
		displayed,
		setColumnWidth,
		toggleExpanded,
		toggleFilters,
		setView,
		setGroup,
		setAccessGroup,
		dispose,
	};
}
export type ModelsStore = ReturnType<typeof createModelsStore>;
