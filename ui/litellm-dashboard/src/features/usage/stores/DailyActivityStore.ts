import { reactive } from "vue";
import { dailyActivityApi } from "../api/DailyActivityApi";
import type { DailyActivityResponse, UsageApi, UsageMetadata, UsageQuery } from "../support/UsageModels";
export const summedMetadataKeys = [
	"total_spend",
	"total_prompt_tokens",
	"total_completion_tokens",
	"total_tokens",
	"total_api_requests",
	"total_successful_requests",
	"total_failed_requests",
	"total_cache_read_input_tokens",
	"total_cache_creation_input_tokens",
] as const;
export function emptyDailyActivity(): DailyActivityResponse {
	return {
		results: [],
		metadata: {
			total_spend: 0,
			total_prompt_tokens: 0,
			total_completion_tokens: 0,
			total_tokens: 0,
			total_api_requests: 0,
			total_successful_requests: 0,
			total_failed_requests: 0,
			total_cache_read_input_tokens: 0,
			total_cache_creation_input_tokens: 0,
			total_pages: 1,
			has_more: false,
			page: 1,
		},
	};
}
function sumMetadata(a: UsageMetadata, b: UsageMetadata): UsageMetadata {
	const result = { ...a };
	for (const key of summedMetadataKeys) result[key] = (a[key] || 0) + (b[key] || 0);
	return result;
}
function pause(signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		const finish = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", finish);
			resolve();
		};
		const timer = setTimeout(finish, 300);
		signal.addEventListener("abort", finish, { once: true });
	});
}
/** Owns one query, including aggregate fallback and its progressive pages. */
export function createDailyActivityStore(api: UsageApi = dailyActivityApi) {
	const state = reactive({
		data: emptyDailyActivity(),
		loading: false,
		isFetchingMore: false,
		progress: { currentPage: 0, totalPages: 0 },
		cancelled: false,
		error: null as Error | null,
		aggregateFailed: false,
	});
	let generation = 0,
		disposed = false,
		controller: AbortController | null = null;
	function reset() {
		generation++;
		controller?.abort();
		controller = null;
		state.data = emptyDailyActivity();
		state.loading = false;
		state.isFetchingMore = false;
		state.progress = { currentPage: 0, totalPages: 0 };
		state.cancelled = false;
		state.error = null;
		state.aggregateFailed = false;
	}
	async function load(query: UsageQuery, preferAggregate = query.entity === "global"): Promise<void> {
		if (disposed) return;
		const current = ++generation;
		controller?.abort();
		const request = new AbortController();
		controller = request;
		const captured = { ...query, from: new Date(query.from), to: new Date(query.to), selected: [...query.selected] };
		const stale = () => disposed || current !== generation || request.signal.aborted;
		state.loading = true;
		state.data = emptyDailyActivity();
		state.isFetchingMore = false;
		state.cancelled = false;
		state.error = null;
		state.aggregateFailed = false;
		state.progress = { currentPage: 1, totalPages: 1 };
		try {
			if (preferAggregate) {
				try {
					const data = await api.aggregated(captured, request.signal);
					if (stale()) return;
					state.data = data;
					state.loading = false;
					return;
				} catch {
					if (stale()) return;
					state.aggregateFailed = true;
				}
			}
			const first = await api.page(captured, 1, request.signal);
			if (stale()) return;
			state.data = first;
			state.loading = false;
			const total = first.metadata.total_pages || 1;
			state.progress = { currentPage: 1, totalPages: total };
			if (total <= 1) return;
			state.isFetchingMore = true;
			let results = [...first.results],
				metadata = { ...first.metadata };
			for (let page = 2; page <= total; page++) {
				await pause(request.signal);
				if (stale()) return;
				const next = await api.page(captured, page, request.signal);
				if (stale()) return;
				results = results.concat(next.results);
				metadata = sumMetadata(metadata, next.metadata);
				metadata.total_pages = total;
				metadata.has_more = page < total;
				metadata.page = page;
				if (page === total || (page - 1) % 3 === 0) {
					state.data = { results, metadata };
					state.progress = { currentPage: page, totalPages: total };
				}
			}
		} catch (error: unknown) {
			if (!stale()) state.error = error instanceof Error ? error : new Error(String(error));
		} finally {
			if (current === generation && !disposed) {
				state.loading = false;
				state.isFetchingMore = false;
				if (controller === request) controller = null;
			}
		}
	}
	function cancel() {
		generation++;
		controller?.abort();
		controller = null;
		state.cancelled = true;
		state.loading = false;
		state.isFetchingMore = false;
	}
	function dispose() {
		disposed = true;
		generation++;
		controller?.abort();
		controller = null;
	}
	return { state, load, cancel, reset, dispose };
}
