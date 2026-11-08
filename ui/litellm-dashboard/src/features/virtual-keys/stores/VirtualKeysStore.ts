import { reactive } from "vue";
import { virtualKeysApi, type VirtualKeysApi } from "../api/VirtualKeysApi";
import { loadKeyCatalog } from "../data/KeyCatalogData";
import { emptyKeyCatalog, type KeyCatalog, type KeyFilters, type VirtualKey } from "../support/VirtualKeyModels";

export function emptyKeyFilters(): KeyFilters {
	return { team: "", organization: "", alias: "", user: "", hash: "" };
}
export function createVirtualKeysStore(api: VirtualKeysApi = virtualKeysApi) {
	const state = reactive({
		rows: [] as VirtualKey[],
		total: 0,
		page: 1,
		pageSize: 50,
		sortBy: "created_at",
		sortOrder: "desc" as "asc" | "desc",
		filters: emptyKeyFilters(),
		catalog: emptyKeyCatalog(),
		catalogLoading: false,
		loading: true,
		refreshing: false,
		pendingToken: "",
		error: "",
		message: "",
	});
	let generation = 0;
	let controller: AbortController | null = null;
	let catalogRequest: Promise<KeyCatalog> | null = null;
	async function refresh() {
		const current = ++generation;
		controller?.abort();
		controller = new AbortController();
		state.refreshing = true;
		state.error = "";
		try {
			const response = await api.listKeys(
				{ page: state.page, size: state.pageSize, sortBy: state.sortBy, sortOrder: state.sortOrder, filters: { ...state.filters } },
				controller.signal,
			);
			if (current !== generation) return;
			state.rows = response.keys;
			state.total = response.total_count;
		} catch (error: unknown) {
			if (current === generation && !(error instanceof DOMException && error.name === "AbortError"))
				state.error = error instanceof Error ? error.message : "Failed to load keys";
		} finally {
			if (current === generation) {
				state.loading = false;
				state.refreshing = false;
			}
		}
	}
	async function catalog(teamId?: string): Promise<KeyCatalog> {
		if (catalogRequest && !teamId) return catalogRequest;
		state.catalogLoading = true;
		const pending = loadKeyCatalog(teamId)
			.then((result) => {
				if (generation >= 0) state.catalog = result;
				return result;
			})
			.finally(() => {
				state.catalogLoading = false;
				if (catalogRequest === pending) catalogRequest = null;
			});
		if (!teamId) catalogRequest = pending;
		return pending;
	}
	function filter(filters: KeyFilters) {
		state.filters = { ...filters };
		state.page = 1;
		return refresh();
	}
	function resetFilters() {
		return filter(emptyKeyFilters());
	}
	function sort(key: string) {
		state.sortOrder =
			state.sortBy === key ? (state.sortOrder === "asc" ? "desc" : "asc") : ["spend", "max_budget"].includes(key) ? "desc" : "asc";
		state.sortBy = key;
		return refresh();
	}
	function page(value: number) {
		state.page = Math.max(1, Math.min(value, Math.max(1, Math.ceil(state.total / state.pageSize))));
		return refresh();
	}
	async function toggleEnabled(key: VirtualKey, enabled: boolean) {
		if (state.pendingToken) return;
		state.pendingToken = key.token;
		try {
			await api.updateKey({ token: key.token, blocked: !enabled });
			await refresh();
		} catch (error: unknown) {
			state.error = error instanceof Error ? error.message : "Failed to update key";
		} finally {
			state.pendingToken = "";
		}
	}
	function dispose() {
		generation = -1;
		controller?.abort();
	}
	return { state, refresh, catalog, filter, resetFilters, sort, page, toggleEnabled, dispose };
}
export type VirtualKeysStore = ReturnType<typeof createVirtualKeysStore>;
