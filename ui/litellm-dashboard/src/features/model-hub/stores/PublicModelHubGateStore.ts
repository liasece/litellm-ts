import { shallowReactive } from "vue";
import { modelHubApi } from "../api/ModelHubApi";
import { getApiBaseUrl } from "../../platform/api/HttpApiClient";
export function createPublicModelHubGateStore(redirect: (url: string) => void) {
	const state = shallowReactive({ ready: false, allowed: false }),
		controller = new AbortController();
	let generation = 0;
	async function load(hasKey: boolean) {
		const current = ++generation,
			signal = controller.signal;
		state.ready = false;
		state.allowed = false;
		try {
			const settings = await modelHubApi.settings(signal).catch(() => undefined);
			if (current !== generation) return;
			if (settings?.require_auth_for_public_ai_hub) {
				const authenticated = await modelHubApi.session(signal).catch(() => false);
				if (current !== generation) return;
				if (!authenticated) {
					redirect(getApiBaseUrl() + "/ui/login");
					return;
				}
			}
			if (hasKey) {
				await modelHubApi.models(signal);
				const enabled = await modelHubApi.publicEnabled(signal).catch(() => false);
				if (current === generation) state.allowed = enabled;
			} else {
				await modelHubApi.publicModels(signal);
				if (current === generation) state.allowed = true;
			}
		} catch {
			if (current === generation) state.allowed = false;
		} finally {
			if (current === generation) state.ready = true;
		}
	}
	function dispose() {
		generation++;
		controller.abort();
	}
	return { state, load, dispose };
}
