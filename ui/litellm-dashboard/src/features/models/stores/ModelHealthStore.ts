import { reactive } from "vue";
import { modelsApi, type ModelsApi } from "../api/ModelsApi";
import { extractMeaningfulHealthError, normalizeHealthErrorPayload } from "../logic/ModelHealthErrorLogic";
import { modelRecord, modelString, type ModelHealthStatus, type ModelHealthResponse } from "../support/ModelModels";
export const defaultModelHealth = (): ModelHealthStatus => ({ status: "none", lastCheck: "None", lastSuccess: "None", loading: false });
export function createModelHealthStore(api: ModelsApi = modelsApi) {
	const state = reactive({ statuses: {} as Record<string, ModelHealthStatus>, error: "", allLoading: false });
	let ids = new Set<string>(),
		generation = 0,
		disposed = false;
	function initialize(known: readonly string[]) {
		ids = new Set(known.filter(Boolean));
		state.statuses = Object.fromEntries([...ids].map((id) => [id, state.statuses[id] ?? defaultModelHealth()]));
		generation++;
	}
	async function hydrate() {
		const current = generation;
		try {
			const latest = await api.fetchLatestHealth();
			if (disposed || current !== generation) return;
			for (const [id, value] of Object.entries(modelRecord(latest.latest_health_checks))) {
				if (!ids.has(id)) continue;
				const check = modelRecord(value),
					checked = modelString(check.checked_at);
				const status = check.status === "healthy" || check.status === "unhealthy" ? check.status : "unknown";
				const fullError = check.error_message == null ? undefined : normalizeHealthErrorPayload(check.error_message);
				state.statuses[id] = {
					status,
					lastCheck: checked ? new Date(checked).toLocaleString() : "None",
					lastSuccess:
						status === "healthy" && checked ? new Date(checked).toLocaleString() : state.statuses[id]?.lastSuccess || "None",
					loading: false,
					error: fullError ? extractMeaningfulHealthError(fullError) : undefined,
					fullError,
					successResponse: status === "healthy" ? check : undefined,
				};
			}
		} catch {
			/* Legacy health history is optional. */
		}
	}
	function apply(response: ModelHealthResponse, targets: ReadonlySet<string>) {
		const now = new Date().toLocaleString();
		for (const id of targets)
			if (ids.has(id)) state.statuses[id] = { ...(state.statuses[id] ?? defaultModelHealth()), loading: false, status: "none" };
		for (const endpoint of response.healthy_endpoints ?? []) {
			const id = modelString(endpoint.model_id);
			if (!targets.has(id) || !ids.has(id)) continue;
			state.statuses[id] = { status: "healthy", lastCheck: now, lastSuccess: now, loading: false, successResponse: endpoint };
		}
		for (const endpoint of response.unhealthy_endpoints ?? []) {
			const id = modelString(endpoint.model_id);
			if (!targets.has(id) || !ids.has(id)) continue;
			const fullError = normalizeHealthErrorPayload(endpoint.error);
			state.statuses[id] = {
				...(state.statuses[id] ?? defaultModelHealth()),
				status: "unhealthy",
				lastCheck: now,
				loading: false,
				error: extractMeaningfulHealthError(fullError),
				fullError,
			};
		}
	}
	async function one(id: string) {
		if (!ids.has(id)) return;
		const current = generation;
		state.error = "";
		state.statuses[id] = { ...(state.statuses[id] ?? defaultModelHealth()), loading: true, status: "checking" };
		try {
			const response = await api.checkModelHealth(id);
			if (disposed || current !== generation) return;
			if (response.healthy_count === 0 && response.unhealthy_count === 0) throw new Error("Health check returned no results");
			apply(response, new Set([id]));
		} catch (error) {
			if (disposed || current !== generation) return;
			const fullError = normalizeHealthErrorPayload(error);
			state.statuses[id] = {
				...(state.statuses[id] ?? defaultModelHealth()),
				status: "unhealthy",
				lastCheck: new Date().toLocaleString(),
				loading: false,
				error: extractMeaningfulHealthError(fullError),
				fullError,
			};
			state.error = error instanceof Error ? error.message : fullError;
		}
	}
	async function all() {
		if (!ids.size) return false;
		const current = generation,
			targets = new Set(ids);
		state.error = "";
		state.allLoading = true;
		for (const id of targets) state.statuses[id] = { ...(state.statuses[id] ?? defaultModelHealth()), loading: true };
		try {
			const response = await api.checkModelHealth();
			if (disposed || current !== generation) return false;
			apply(response, targets);
			return true;
		} catch (error) {
			if (!disposed && current === generation) {
				for (const id of targets) state.statuses[id].loading = false;
				state.error = error instanceof Error ? error.message : normalizeHealthErrorPayload(error);
			}
			return false;
		} finally {
			if (!disposed && current === generation) state.allLoading = false;
		}
	}
	function dispose() {
		disposed = true;
		generation++;
	}
	return {
		state,
		initialize,
		hydrate,
		one,
		all,
		selected: (values: readonly string[]) => Promise.all(values.filter((id) => ids.has(id)).map(one)),
		dispose,
	};
}
export type ModelHealthStore = ReturnType<typeof createModelHealthStore>;
