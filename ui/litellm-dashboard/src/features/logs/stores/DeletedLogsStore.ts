import { computed, reactive, shallowRef } from "vue";
import { auxiliaryLogsApi } from "../api/AuxiliaryLogsApi";
export function createDeletedLogsStore(kind: "keys" | "teams") {
	const state = reactive({ page: 1, loading: true, fetching: false, total: 0, error: null as string | null });
	const rows = shallowRef<Record<string, unknown>[]>([]);
	let generation = 0,
		disposed = false,
		request: AbortController | null = null;
	async function load() {
		const current = ++generation;
		request?.abort();
		request = new AbortController();
		state.fetching = true;
		state.error = null;
		try {
			if (kind === "keys") {
				const data = await auxiliaryLogsApi.deletedKeys(state.page, request.signal);
				if (disposed || generation !== current) return;
				rows.value = data.keys;
				state.total = data.total_count;
			} else {
				const data = await auxiliaryLogsApi.deletedTeams(request.signal);
				if (disposed || generation !== current) return;
				rows.value = data;
				state.total = data.length;
			}
		} catch (error: unknown) {
			if (!disposed && generation === current && !(error instanceof DOMException && error.name === "AbortError"))
				state.error = error instanceof Error ? error.message : "Failed to load deleted " + kind;
		} finally {
			if (!disposed && generation === current) {
				state.loading = false;
				state.fetching = false;
			}
		}
	}
	function page(value: number) {
		state.page = Math.max(1, value);
		void load();
	}
	function dispose() {
		disposed = true;
		generation++;
		request?.abort();
	}
	return { state, rows, page, load, dispose, pages: computed(() => Math.ceil(state.total / 50)) };
}
