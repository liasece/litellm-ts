import { computed, reactive, shallowRef } from "vue";
type AccessRecord = Record<string, unknown>;
export function createResourceStore<T extends AccessRecord>(
	load: (signal: AbortSignal) => Promise<T[]>,
	detail?: (id: string, signal: AbortSignal) => Promise<T>,
	searchable?: (row: T, query: string) => boolean,
) {
	const rows = shallowRef<T[]>([]),
		selected = shallowRef<T | null>(null);
	const state = reactive({
		loading: true,
		detailLoading: false,
		pending: false,
		error: "",
		message: "",
		query: "",
		page: 1,
		pageSize: 10,
		sortBy: "",
		sortOrder: "asc" as "asc" | "desc",
	});
	let generation = 0,
		detailGeneration = 0;
	let controller: AbortController | null = null,
		detailController: AbortController | null = null;
	async function refresh() {
		const current = ++generation;
		controller?.abort();
		controller = new AbortController();
		state.loading = true;
		state.error = "";
		try {
			const result = await load(controller.signal);
			if (current === generation) rows.value = result;
		} catch (error: unknown) {
			if (current === generation && !(error instanceof DOMException && error.name === "AbortError"))
				state.error = error instanceof Error ? error.message : "Failed to load data";
		} finally {
			if (current === generation) state.loading = false;
		}
	}
	async function open(id: string, seed?: T) {
		const current = ++detailGeneration;
		detailController?.abort();
		detailController = new AbortController();
		selected.value = seed ?? null;
		state.detailLoading = true;
		state.error = "";
		try {
			if (detail) {
				const result = await detail(id, detailController.signal);
				if (current === detailGeneration) selected.value = result;
			}
		} catch (error: unknown) {
			if (current === detailGeneration && !(error instanceof DOMException && error.name === "AbortError"))
				state.error = error instanceof Error ? error.message : "Failed to load details";
		} finally {
			if (current === detailGeneration) state.detailLoading = false;
		}
	}
	function close() {
		++detailGeneration;
		detailController?.abort();
		selected.value = null;
		state.detailLoading = false;
	}
	async function run(operation: () => Promise<unknown>, message: string, after?: () => void | Promise<void>): Promise<boolean> {
		if (state.pending) return false;
		state.pending = true;
		state.error = "";
		state.message = "";
		try {
			await operation();
			state.message = message;
			await refresh();
			await after?.();
			return true;
		} catch (error: unknown) {
			state.error = error instanceof Error ? error.message : "Request failed";
			return false;
		} finally {
			state.pending = false;
		}
	}
	const filtered = computed(() => {
		const query = state.query.toLocaleLowerCase();
		return rows.value.filter(
			(row) =>
				!query ||
				(searchable
					? searchable(row, query)
					: Object.values(row).some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(query))),
		);
	});
	const ordered = computed(() => {
		if (!state.sortBy) return filtered.value;
		return [...filtered.value].sort((a, b) => {
			const av = a[state.sortBy],
				bv = b[state.sortBy];
			const comparison =
				typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""));
			return state.sortOrder === "asc" ? comparison : -comparison;
		});
	});
	function sort(key: string, order: "asc" | "desc" | null) {
		state.sortBy = order ? key : "";
		state.sortOrder = order ?? "asc";
	}

	function dispose() {
		++generation;
		++detailGeneration;
		controller?.abort();
		detailController?.abort();
	}
	return { rows, selected, state, filtered, ordered, sort, refresh, open, close, run, dispose };
}
