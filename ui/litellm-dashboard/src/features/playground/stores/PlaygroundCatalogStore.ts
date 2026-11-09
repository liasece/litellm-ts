import { shallowReactive } from "vue";
import { playgroundOptionsApi } from "../api/PlaygroundOptionsApi";
import type { PlaygroundModel } from "../support/PlaygroundModels";
export function createPlaygroundCatalogStore(api = playgroundOptionsApi) {
	const state = shallowReactive({
		loading: false,
		models: [] as PlaygroundModel[],
		settings: {} as Record<string, unknown>,
		error: null as string | null,
	});
	let controller: AbortController | undefined,
		generation = 0,
		pending: Promise<void> | null = null;
	async function load() {
		if (pending) return pending;
		controller = new AbortController();
		const signal = controller.signal,
			current = ++generation;
		state.loading = true;
		const request = (async () => {
			const result = await Promise.allSettled([api.models(signal), api.settings(signal)]);
			if (current !== generation || signal.aborted) return;
			if (result[0].status === "fulfilled") state.models = result[0].value;
			else state.error = result[0].reason instanceof Error ? result[0].reason.message : "Failed to fetch models";
			if (result[1].status === "fulfilled") state.settings = result[1].value;
		})().finally(() => {
			if (current === generation) state.loading = false;
			if (pending === request) pending = null;
		});
		pending = request;
		return request;
	}
	function dispose() {
		generation++;
		controller?.abort();
		pending = null;
	}
	return { state, load, dispose };
}
export type PlaygroundCatalogStore = ReturnType<typeof createPlaygroundCatalogStore>;
