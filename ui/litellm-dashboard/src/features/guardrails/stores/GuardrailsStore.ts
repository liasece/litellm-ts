import { ref, reactive, computed } from "vue";
import { guardrailsApi } from "../api/GuardrailsApi";
import type { GuardrailRecord } from "../support/GuardrailModels";
import { notificationManager } from "../../notifications/logic/NotificationManager";
export function createGuardrailsStore(authorized: () => boolean, api = guardrailsApi) {
	const rows = ref<GuardrailRecord[]>([]),
		state = reactive({
			loading: false,
			tab: "garden",
			add: false,
			customCode: false,
			selectedId: "",
			deleting: false,
			deleteOpen: false,
		}),
		deletingRecord = ref<GuardrailRecord | null>(null);
	let generation = 0,
		disposed = false;
	async function load() {
		if (!authorized()) return;
		const current = ++generation;
		state.loading = true;
		try {
			const value = await api.list();
			if (!disposed && current === generation) rows.value = value;
		} catch {
			return;
		} finally {
			if (!disposed && current === generation) state.loading = false;
		}
	}
	function remove(row: GuardrailRecord) {
		deletingRecord.value = row;
		state.deleteOpen = true;
	}
	async function confirmDelete() {
		if (!deletingRecord.value?.guardrail_id || !authorized()) return;
		state.deleting = true;
		try {
			await api.delete(deletingRecord.value.guardrail_id);
			notificationManager.success('Guardrail "' + deletingRecord.value.guardrail_name + '" deleted successfully');
			await load();
		} catch {
			notificationManager.fromBackend("Failed to delete guardrail");
		} finally {
			state.deleting = false;
			state.deleteOpen = false;
			deletingRecord.value = null;
		}
	}
	return {
		rows,
		state,
		deletingRecord,
		load,
		remove,
		confirmDelete,
		canTest: computed(() => authorized() && rows.value.length > 0),
		dispose() {
			disposed = true;
			++generation;
		},
	};
}
