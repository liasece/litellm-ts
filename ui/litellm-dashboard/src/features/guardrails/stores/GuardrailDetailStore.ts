import { reactive, ref, computed } from "vue";
import { guardrailsApi } from "../api/GuardrailsApi";
import { populateGuardrailProviders, populateGuardrailProviderMap } from "../logic/GuardrailProviderLogic";
import { emptyGuardrailContent, emptyToolPermissions } from "../logic/GuardrailCreateLogic";
import { contentFromGuardrail } from "../logic/GuardrailContentLogic";
import { toolPermissionsFromGuardrail, buildGuardrailUpdatePayload, guardrailOptionalInitialValues } from "../logic/GuardrailUpdateLogic";
import type { GuardrailRecord, GuardrailProviderParameters, GuardrailUiSettings } from "../support/GuardrailModels";
import { notificationManager } from "../../notifications/logic/NotificationManager";
export function createGuardrailDetailStore(id: string, authorized: () => boolean, api = guardrailsApi) {
	const record = ref<GuardrailRecord | null>(null),
		providers = ref<GuardrailProviderParameters | null>(null),
		settings = ref<GuardrailUiSettings | null>(null),
		values = ref<Record<string, unknown>>({}),
		content = ref(emptyGuardrailContent()),
		permissions = ref(emptyToolPermissions()),
		pii = reactive({ entities: [] as string[], actions: {} as Record<string, string> }),
		state = reactive({
			loading: false,
			editing: false,
			customCode: false,
			tab: "overview",
			saving: false,
			toolDirty: false,
			contentBaseline: "",
			nameError: "",
		});
	let generation = 0,
		disposed = false;
	function derive() {
		if (!record.value) return;
		const data = record.value;
		values.value = {
			guardrail_name: data.guardrail_name,
			...data.litellm_params,
			optional_params: guardrailOptionalInitialValues(
				data.litellm_params,
				providers.value?.[data.litellm_params.guardrail.toLowerCase()]?.optional_params?.fields,
			),
			guardrail_info: data.guardrail_info ? JSON.stringify(data.guardrail_info, null, 2) : "",
		};
		pii.entities = Object.keys(data.litellm_params.pii_entities_config ?? {});
		pii.actions = Object.fromEntries(
			pii.entities.map((key) => [
				key,
				typeof data.litellm_params.pii_entities_config?.[key] === "string"
					? String(data.litellm_params.pii_entities_config[key])
					: "MASK",
			]),
		);
		permissions.value = toolPermissionsFromGuardrail(data);
		state.toolDirty = false;
		content.value = contentFromGuardrail(data, settings.value);
		state.contentBaseline = JSON.stringify(content.value);
	}
	async function load() {
		if (!authorized()) return;
		const current = ++generation;
		state.loading = true;
		try {
			const value = await api.detail(id);
			if (!disposed && current === generation) {
				record.value = value;
				derive();
			}
		} catch {
			if (!disposed && current === generation) notificationManager.fromBackend("Failed to fetch guardrail info");
		} finally {
			if (!disposed && current === generation) state.loading = false;
		}
	}
	async function metadata() {
		if (!authorized()) return;
		await Promise.allSettled([
			api.providers().then((value) => {
				if (disposed) return;
				providers.value = value;
				populateGuardrailProviders(value);
				populateGuardrailProviderMap(value);
				derive();
			}),
			api.settings().then((value) => {
				if (disposed) return;
				settings.value = value;
				derive();
			}),
		]);
	}
	function cancel() {
		if (record.value) content.value = contentFromGuardrail(record.value, settings.value);
		state.editing = false;
		state.contentBaseline = JSON.stringify(content.value);
		if (record.value) permissions.value = toolPermissionsFromGuardrail(record.value);
		state.toolDirty = false;
	}
	async function save() {
		if (!authorized() || !record.value) return false;
		state.nameError = "";
		if (!values.value.guardrail_name) {
			state.nameError = "Please input a guardrail name";
			return false;
		}
		try {
			const body = buildGuardrailUpdatePayload(
				record.value,
				values.value,
				providers.value,
				pii.entities,
				pii.actions,
				content.value,
				JSON.stringify(content.value) !== state.contentBaseline,
				permissions.value,
				state.toolDirty,
			);
			if (!Object.keys(body).length) {
				notificationManager.info("No changes detected");
				state.editing = false;
				return true;
			}
			state.saving = true;
			await api.update(id, body);
			notificationManager.success("Guardrail updated successfully");
			state.editing = false;
			await load();
			return true;
		} catch {
			notificationManager.fromBackend("Failed to update guardrail");
			return false;
		} finally {
			state.saving = false;
		}
	}
	return {
		record,
		providers,
		settings,
		values,
		content,
		permissions,
		pii,
		state,
		load,
		metadata,
		derive,
		cancel,
		save,
		contentDirty: computed(() => JSON.stringify(content.value) !== state.contentBaseline),
		dispose() {
			disposed = true;
			++generation;
		},
	};
}
export type GuardrailDetailStore = ReturnType<typeof createGuardrailDetailStore>;
