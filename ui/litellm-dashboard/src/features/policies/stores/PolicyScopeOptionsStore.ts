import { reactive } from "vue";
import { policiesApi } from "../api/PoliciesApi";
export function createPolicyScopeOptionsStore(userId?: string) {
	const state = reactive({
		teams: [] as string[],
		keys: [] as string[],
		models: [] as string[],
		teamsLoading: false,
		keysLoading: false,
		modelsLoading: false,
	});
	let disposed = false;
	async function loadKey(key: "teams" | "keys" | "models") {
		state[(key + "Loading") as "teamsLoading" | "keysLoading" | "modelsLoading"] = true;
		try {
			const result =
				key === "teams" ? await policiesApi.teams(userId) : key === "keys" ? await policiesApi.keys() : await policiesApi.models();
			if (!disposed) state[key] = result;
		} catch {
			/* Optional lists still allow custom wildcard values. */
		} finally {
			if (!disposed) state[(key + "Loading") as "teamsLoading" | "keysLoading" | "modelsLoading"] = false;
		}
	}
	return {
		state,
		load: () => Promise.allSettled([loadKey("teams"), loadKey("keys"), loadKey("models")]),
		loadModels: () => loadKey("models"),
		dispose: () => {
			disposed = true;
		},
	};
}
