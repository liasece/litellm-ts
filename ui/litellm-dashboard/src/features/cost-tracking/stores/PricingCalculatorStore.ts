import { computed, reactive, shallowRef } from "vue";
import { costTrackingApi, type CostTrackingApi } from "../api/CostTrackingApi";
import { aggregateEstimates, estimateRequest } from "../logic/CostTrackingLogic";
import type { EntryEstimate, ModelEntry } from "../support/CostTrackingModels";
export function createPricingCalculatorStore(api: Pick<CostTrackingApi, "estimate"> = costTrackingApi) {
	let sequence = 0,
		disposed = false;
	const defaultEntry = (): ModelEntry => ({ id: "cost-entry-" + ++sequence, model: "", input_tokens: 1000, output_tokens: 500 });
	const state = reactive({ entries: [defaultEntry()], period: "month" as "day" | "month" });
	const cache = shallowRef(new Map<string, EntryEstimate>()),
		timers = new Map<string, ReturnType<typeof setTimeout>>(),
		requests = new Map<string, AbortController>(),
		generations = new Map<string, number>();
	function updateCache(id: string, value: EntryEstimate | null) {
		const next = new Map(cache.value);
		if (value) next.set(id, value);
		else next.delete(id);
		cache.value = next;
	}
	async function fetch(entry: ModelEntry) {
		if (disposed || !entry.model) return;
		const generation = (generations.get(entry.id) ?? 0) + 1;
		generations.set(entry.id, generation);
		requests.get(entry.id)?.abort();
		const request = new AbortController();
		requests.set(entry.id, request);
		updateCache(entry.id, { entry, result: cache.value.get(entry.id)?.result ?? null, loading: true, error: null });
		try {
			const result = await api.estimate(estimateRequest(entry), request.signal);
			if (!disposed && generations.get(entry.id) === generation)
				updateCache(entry.id, { entry, result, loading: false, error: null });
		} catch (error: unknown) {
			if (!disposed && generations.get(entry.id) === generation && !(error instanceof DOMException && error.name === "AbortError"))
				updateCache(entry.id, {
					entry,
					result: null,
					loading: false,
					error: error instanceof Error && "status" in error ? error.message : "Network error",
				});
		} finally {
			if (requests.get(entry.id) === request) requests.delete(entry.id);
		}
	}
	function schedule(entry: ModelEntry) {
		if (timers.has(entry.id)) clearTimeout(timers.get(entry.id));
		generations.set(entry.id, (generations.get(entry.id) ?? 0) + 1);
		requests.get(entry.id)?.abort();
		timers.set(
			entry.id,
			setTimeout(() => {
				timers.delete(entry.id);
				void fetch({ ...entry });
			}, 500),
		);
	}
	function change(id: string, field: keyof Omit<ModelEntry, "id">, value: string | number | undefined) {
		state.entries = state.entries.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry));
		const entry = state.entries.find((entry) => entry.id === id);
		if (entry?.model) schedule(entry);
	}
	function setPeriod(period: "day" | "month") {
		state.period = period;
		state.entries = state.entries.map((entry) => ({
			...entry,
			num_requests_per_day: period === "day" ? entry.num_requests_per_day : undefined,
			num_requests_per_month: period === "month" ? entry.num_requests_per_month : undefined,
		}));
	}
	function add() {
		state.entries.push(defaultEntry());
	}
	function remove(id: string) {
		if (state.entries.length <= 1) return;
		state.entries = state.entries.filter((entry) => entry.id !== id);
		const timer = timers.get(id);
		if (timer) clearTimeout(timer);
		timers.delete(id);
		requests.get(id)?.abort();
		requests.delete(id);
		generations.set(id, (generations.get(id) ?? 0) + 1);
		updateCache(id, null);
	}
	function dispose() {
		disposed = true;
		for (const timer of timers.values()) clearTimeout(timer);
		for (const request of requests.values()) request.abort();
		timers.clear();
		requests.clear();
	}
	return { state, result: computed(() => aggregateEstimates(state.entries, cache.value)), change, setPeriod, add, remove, dispose };
}
