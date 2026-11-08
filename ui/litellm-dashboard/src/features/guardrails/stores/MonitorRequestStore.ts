import { ref, shallowRef } from "vue";
export function createMonitorRequestStore<T>(load: (signal: AbortSignal) => Promise<T>) {
	const data = shallowRef<T | null>(null),
		loading = ref(false),
		error = ref<unknown>(null);
	let generation = 0,
		controller: AbortController | null = null,
		disposed = false;
	async function refresh(keepPrevious = false) {
		controller?.abort();
		controller = new AbortController();
		const current = ++generation,
			signal = controller.signal;
		if (!keepPrevious) data.value = null;
		loading.value = true;
		error.value = null;
		try {
			const value = await load(signal);
			if (!disposed && current === generation) data.value = value;
		} catch (reason) {
			if (!disposed && current === generation && !signal.aborted) error.value = reason;
		} finally {
			if (!disposed && current === generation) loading.value = false;
		}
	}
	return {
		data,
		loading,
		error,
		refresh,
		dispose() {
			disposed = true;
			++generation;
			controller?.abort();
		},
	};
}
