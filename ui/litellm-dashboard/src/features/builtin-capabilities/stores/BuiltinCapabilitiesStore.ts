import { reactive } from "vue";
import { builtinCapabilitiesApi, type BuiltinCapabilitiesApi } from "../api/BuiltinCapabilitiesApi";
import type { Capabilities, Choice, BuiltinCapabilitiesResponse } from "../support/BuiltinCapabilitiesModels";
import { validateCapabilities } from "../logic/ExecutorChainLogic";
import { builtinCapabilitiesFormValues } from "../logic/BuiltinCapabilitiesFormLogic";
import notificationManager from "../../notifications/logic/NotificationManager";
export function createBuiltinCapabilitiesStore(api: BuiltinCapabilitiesApi = builtinCapabilitiesApi) {
	const state = reactive({
		capabilities: { vision: {}, image_generation: {}, web: {} } as Capabilities,
		data: null as BuiltinCapabilitiesResponse | null,
		credentials: [] as Choice[],
		loading: true,
		saving: false,
		errors: {} as Record<string, string>,
	});
	let disposed = false;
	async function initialize() {
		void api
			.credentials()
			.then((values) => {
				if (!disposed) state.credentials = values;
			})
			.catch(() => undefined);
		try {
			const value = await api.load();
			if (!disposed) {
				state.data = value;
				state.capabilities = structuredClone(value.capabilities);
			}
		} catch {
			if (!disposed) notificationManager.fromBackend("Failed to load built-in capabilities");
		} finally {
			if (!disposed) state.loading = false;
		}
	}
	async function save() {
		state.errors = validateCapabilities(state.capabilities);
		if (Object.keys(state.errors).length || state.saving) return;
		state.saving = true;
		try {
			const value = await api.save(builtinCapabilitiesFormValues(state.capabilities));
			if (!disposed) {
				state.data = value;
				state.capabilities = structuredClone(value.capabilities);
				notificationManager.success("Built-in capabilities updated");
			}
		} catch (error: unknown) {
			if (!disposed)
				notificationManager.fromBackend(error instanceof Error ? error.message : "Failed to update built-in capabilities");
		} finally {
			if (!disposed) state.saving = false;
		}
	}
	return {
		state,
		initialize,
		save,
		dispose: () => {
			disposed = true;
		},
	};
}
