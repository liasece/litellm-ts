import { reactive, shallowRef } from "vue";
import { fetchHealthReadiness, type HealthReadiness } from "../api/HealthReadinessApi";
const FRESHNESS = 5 * 60 * 1000;
function delay(milliseconds: number, signal: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		function abort() {
			clearTimeout(timer);
			reject(new DOMException("Aborted", "AbortError"));
		}
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", abort);
			resolve();
		}, milliseconds);
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
	});
}
export function createHealthReadinessStore(fetcher = fetchHealthReadiness, now = () => Date.now()) {
	const data = shallowRef<HealthReadiness | null>(null),
		state = reactive({ loading: false, error: "", updatedAt: null as number | null });
	let pending: Promise<void> | null = null,
		controller: AbortController | undefined,
		generation = 0,
		subscribers = 0,
		garbageCollection: ReturnType<typeof setTimeout> | undefined;
	function stale() {
		return state.updatedAt === null || now() - state.updatedAt >= FRESHNESS;
	}
	function load(force = false): Promise<void> {
		if (pending) return pending;
		if (!force && !stale()) return Promise.resolve();
		const current = ++generation,
			request = new AbortController();
		controller = request;
		state.loading = true;
		pending = (async () => {
			for (let attempt = 0; attempt < 4; attempt++) {
				try {
					const value = await fetcher(request.signal);
					if (request.signal.aborted || current !== generation) return;
					data.value = value;
					state.updatedAt = now();
					state.error = "";
					return;
				} catch (error) {
					if (request.signal.aborted || current !== generation) return;
					if (attempt === 3) {
						state.error = error instanceof Error ? error.message : String(error);
						return;
					}
					try {
						await delay(1000 * 2 ** attempt, request.signal);
					} catch {
						return;
					}
				}
			}
		})().finally(() => {
			if (current === generation) {
				pending = null;
				controller = undefined;
				state.loading = false;
			}
		});
		return pending;
	}
	function visible() {
		if (typeof document === "undefined" || document.visibilityState === "visible") void load();
	}
	function online() {
		void load();
	}
	function listen(active: boolean) {
		if (typeof document !== "undefined") document[active ? "addEventListener" : "removeEventListener"]("visibilitychange", visible);
		if (typeof window !== "undefined") window[active ? "addEventListener" : "removeEventListener"]("online", online);
	}
	function acquire() {
		if (garbageCollection) clearTimeout(garbageCollection);
		if (subscribers++ === 0) listen(true);
		void load();
		let released = false;
		return () => {
			if (released) return;
			released = true;
			if (--subscribers === 0) {
				listen(false);
				garbageCollection = setTimeout(() => {
					data.value = null;
					state.updatedAt = null;
					state.error = "";
				}, FRESHNESS);
			}
		};
	}
	function dispose() {
		++generation;
		controller?.abort();
		pending = null;
		state.loading = false;
		if (garbageCollection) clearTimeout(garbageCollection);
		listen(false);
		subscribers = 0;
	}
	return { data, state, load, acquire, dispose };
}
export const applicationHealthReadinessStore = createHealthReadinessStore();
