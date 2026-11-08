import { ref, reactive, computed } from "vue";
import { applicationUsageApi } from "../api/ApplicationUsageApi";
import { applicationUsageMetrics } from "../logic/ApplicationUsageLogic";
import type { ApplicationUsageData, ApplicationLicenseInfo } from "../support/ApplicationUsageModels";
export function createApplicationUsageIndicatorStore(authorized: () => boolean, api = applicationUsageApi) {
	const data = ref<ApplicationUsageData | null>(null),
		license = ref<ApplicationLicenseInfo | null>(null),
		state = reactive({ minimized: true, loading: false, error: "" });
	let disposed = false,
		generation = 0;
	async function load() {
		if (!authorized()) return;
		const current = ++generation;
		state.loading = true;
		state.error = "";
		try {
			const [usage, info] = await Promise.all([api.remaining(), api.license().catch(() => null)]);
			if (!disposed && current === generation) {
				data.value = usage;
				license.value = info;
			}
		} catch {
			if (!disposed && current === generation) state.error = "Failed to load usage data";
		} finally {
			if (!disposed && current === generation) state.loading = false;
		}
	}
	return {
		data,
		license,
		state,
		metrics: computed(() => applicationUsageMetrics(data.value, license.value)),
		load,
		dispose() {
			disposed = true;
			++generation;
		},
	};
}
