import { reactive } from "vue";
import { modelSpeed } from "../api/ModelSpeedApi";
import { resolveSpeedRange } from "../logic/ModelSpeedLogic";
import type { ModelSpeedReport, SpeedApi } from "../support/SpeedModels";
import notificationManager from "../../notifications/logic/NotificationManager";
import { HttpApiError } from "../../platform/api/HttpApiClient";
export function createModelSpeedStore(api: SpeedApi = modelSpeed) {
	let timezone = "UTC";
	try {
		timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		/* UTC fallback */
	}
	const state = reactive({
		rangeDays: 7,
		range: resolveSpeedRange(7, timezone),
		timezone,
		query: "",
		data: null as ModelSpeedReport | null,
		loading: true,
		error: null as Error | null,
	});
	const cache = new Map<string, { data: ModelSpeedReport; at: number }>();
	let generation = 0,
		disposed = false,
		initialized = false,
		controller: AbortController | null = null,
		activeKey: string | null = null;
	async function load(force = false) {
		const key = JSON.stringify([state.range, state.timezone]),
			cached = cache.get(key);
		if (!force && activeKey === key && controller && !controller.signal.aborted) return;
		const current = ++generation;
		controller?.abort();
		controller = null;
		activeKey = null;
		if (!force && cached && Date.now() - cached.at < 60000) {
			state.data = cached.data;
			state.loading = false;
			state.error = null;
			return;
		}
		controller = new AbortController();
		const request = controller;
		activeKey = key;
		state.data = cached?.data ?? null;
		state.error = null;
		state.loading = !state.data;
		try {
			for (let attempt = 0; attempt < 4; attempt++) {
				if (disposed || current !== generation || request.signal.aborted) return;
				try {
					const data = await api({ ...state.range, timezone: state.timezone }, request.signal);
					if (disposed || current !== generation) return;
					cache.set(key, { data, at: Date.now() });
					state.data = data;
					state.error = null;
					state.loading = false;
					return;
				} catch (error: unknown) {
					if (disposed || current !== generation || request.signal.aborted) return;
					if (error instanceof HttpApiError) notificationManager.fromBackend(error.message);
					if (attempt === 3) {
						state.error = error instanceof Error ? error : new Error(String(error));
						state.loading = false;
						return;
					}
					await new Promise<void>((resolve) => {
						const timer = setTimeout(resolve, Math.min(1000 * 2 ** attempt, 30000));
						request.signal.addEventListener(
							"abort",
							() => {
								clearTimeout(timer);
								resolve();
							},
							{ once: true },
						);
					});
				}
			}
		} finally {
			if (controller === request) {
				controller = null;
				activeKey = null;
			}
		}
	}
	function setRange(days: number) {
		state.rangeDays = days;
		state.range = resolveSpeedRange(days, timezone);
		void load();
	}
	function focus() {
		if (document.visibilityState === "visible") void load();
	}
	function initialize() {
		if (disposed || initialized) return;
		initialized = true;
		window.addEventListener("focus", focus);
		document.addEventListener("visibilitychange", focus);
		void load();
	}
	function dispose() {
		disposed = true;
		generation++;
		controller?.abort();
		if (initialized) {
			window.removeEventListener("focus", focus);
			document.removeEventListener("visibilitychange", focus);
			initialized = false;
		}
	}
	return { state, initialize, setRange, load, dispose };
}
