import { computed, reactive } from "vue";
import { fetchChoicePage, type ChoiceKind, type PaginatedChoice } from "../api/PaginatedChoiceApi";
export function createPaginatedChoiceStore(kind: ChoiceKind, pageSize = 50, fetchPage = fetchChoicePage) {
	const state = reactive({
		options: [] as PaginatedChoice[],
		page: 0,
		pages: 1,
		loading: false,
		loadingMore: false,
		search: "",
		error: null as string | null,
	});
	let generation = 0,
		disposed = false,
		request: AbortController | null = null,
		timer: ReturnType<typeof setTimeout> | null = null;
	async function load(append = false) {
		if (disposed || (append && (state.loading || state.loadingMore || state.page >= state.pages))) return;
		const current = ++generation;
		request?.abort();
		request = new AbortController();
		if (append) state.loadingMore = true;
		else state.loading = true;
		state.error = null;
		try {
			const result = await fetchPage(kind, append ? state.page + 1 : 1, pageSize, state.search, request.signal);
			if (disposed || current !== generation) return;
			const seen = new Set<string>(),
				options = append ? [...state.options, ...result.options] : result.options;
			state.options = options.filter((option) => {
				if (seen.has(option.value)) return false;
				seen.add(option.value);
				return true;
			});
			state.page = result.page;
			state.pages = result.pages;
		} catch (error: unknown) {
			if (!disposed && current === generation && !(error instanceof DOMException && error.name === "AbortError"))
				state.error = error instanceof Error ? error.message : "Failed to load options";
		} finally {
			if (!disposed && current === generation) {
				state.loading = false;
				state.loadingMore = false;
			}
		}
	}
	function search(value: string) {
		state.search = value;
		generation++;
		request?.abort();
		state.loadingMore = false;
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			void load();
		}, 300);
	}
	function scroll(event: Event) {
		const target = event.target as HTMLElement;
		if ((target.scrollTop + target.clientHeight) / target.scrollHeight >= 0.8) void load(true);
	}
	function dispose() {
		disposed = true;
		generation++;
		request?.abort();
		if (timer !== null) clearTimeout(timer);
	}
	return { state, hasNext: computed(() => state.page < state.pages), load, search, scroll, dispose };
}
