<script setup lang="ts">
import { provideKeyFormIdentity } from "../support/KeyFormIdentity";
import { computed, ref } from "vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { rolesWithWriteAccess } from "../../identity/logic/UserRoleLogic";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import UiAlert from "../../platform/ui/UiAlert.vue";
import notificationManager from "../../notifications/logic/NotificationManager";
import UiButton from "../../platform/ui/UiButton.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import { createKeyDraft, validateKeyDraft } from "../logic/KeyDraftLogic";
import { buildKeyPayload } from "../logic/KeyPayloadLogic";
import { budgetFields, keyTypeOptions, policyFields } from "../render/KeyFormPresentation";
import { selectedString, selectOptions, type KeyCatalog, type VirtualKey } from "../support/VirtualKeyModels";
import type { KeyField } from "../support/KeyFieldModels";
import KeyFieldComponent from "./KeyFieldComponent.vue";
import KeyFormFields from "./KeyFormFieldsComponent.vue";
import KeyAccessFields from "./KeyAccessFieldsComponent.vue";
import KeyLoggingFields from "./KeyLoggingFieldsComponent.vue";
import KeyLifecycleFields from "./KeyLifecycleFieldsComponent.vue";
import "./styles/VirtualKeyForms.css";

const props = defineProps<{ keyData: VirtualKey; catalog: KeyCatalog; pending?: boolean; error?: string }>();
const emit = defineEmits<{ save: [payload: Record<string, unknown>]; cancel: [] }>();
const auth = useAuthenticationStore();
const formatMoney = useMoneyFormatter();
const draft = ref(createKeyDraft(props.keyData));
const errors = ref<Record<string, string>>({});
const team = computed(() => props.catalog.teams.find((team) => team.team_id === draft.value.team_id));
const canEdit = computed(() => auth.state.session?.premium_user || rolesWithWriteAccess.includes(auth.userRole.value));
const models = computed(() => [...new Set([...(team.value?.models || []), ...props.catalog.models, ...props.keyData.models])]);
const fields = computed<KeyField[]>(() => [
	{ name: "key_alias", kind: "text", label: "Key Alias", tremor: true },
	{
		name: "models",
		kind: "multiple",
		label: "Models",
		options: [{ value: "all-team-models", label: "All Team Models" }, ...selectOptions(models.value)],
		disabled: ["management", "read_only"].includes(draft.value.key_type),
	},
	{
		name: "key_type",
		kind: "select",
		label: "Key Type",
		options: keyTypeOptions,
	},
	{
		name: "allowed_routes",
		kind: "text",
		label: "Allowed Routes",
		placeholder:
			"Enter allowed routes (comma-separated). Special values: llm_api_routes, management_routes. Examples: llm_api_routes, /chat/completions, /keys/*. Leave empty to allow all routes",
		tooltip:
			"List of allowed routes for the key (comma-separated). Can be specific routes (e.g., '/chat/completions') or route patterns (e.g., 'llm_api_routes', 'management_routes', '/keys/*'). Leave empty to allow all routes.",
	},
	...budgetFields(team.value, false, formatMoney),
	{ name: "max_parallel_requests", kind: "number", label: "Max Parallel Requests", tremor: true },
	{ name: "model_tpm_limit", kind: "textarea", label: "Model TPM Limit", placeholder: '{"gpt-4": 100, "claude-v1": 200}' },
	{ name: "model_rpm_limit", kind: "textarea", label: "Model RPM Limit", placeholder: '{"gpt-4": 100, "claude-v1": 200}' },
	...policyFields(props.catalog, Boolean(canEdit.value), Boolean(auth.state.session?.premium_user), true),
]);
const teams = computed(() =>
	props.catalog.teams
		.filter((team) => !draft.value.organization_id || team.organization_id === draft.value.organization_id)
		.map((team) => ({ value: team.team_id, label: (team.team_alias || "") + " (" + team.team_id + ")" })),
);
function organization(value: unknown) {
	draft.value.organization_id = selectedString(value);
	draft.value.team_id = "";
	draft.value.omitTeamOnUpdate = true;
}
function selectTeam(value: unknown) {
	draft.value.team_id = selectedString(value);
	draft.value.omitTeamOnUpdate = false;
	draft.value.organization_id = props.catalog.teams.find((team) => team.team_id === draft.value.team_id)?.organization_id || "";
}
function submit() {
	const invalid = validateKeyDraft(draft.value, { creating: false });
	if (Object.keys(invalid).length) {
		if (invalid.metadataText) notificationManager.fromBackend(invalid.metadataText);
		errors.value = Object.fromEntries(Object.entries(invalid).filter(([name]) => name !== "metadataText"));
		return;
	}
	errors.value = {};
	try {
		emit(
			"save",
			buildKeyPayload(draft.value, {
				userId: auth.state.session?.user_id || "",
				key: props.keyData,
				canEditGuardrails: Boolean(canEdit.value),
			}),
		);
	} catch (reason: unknown) {
		notificationManager.fromBackend(reason instanceof Error ? reason.message : "Invalid metadata JSON");
	}
}
const fieldId = provideKeyFormIdentity("key-edit");
</script>
<template>
	<form class="vk-edit-form" @submit.prevent="submit">
		<UiAlert v-if="error" type="error" class="vk-form-error">{{ error }}</UiAlert>
		<KeyFieldComponent
			label="Enabled"
			tooltip-icon="QuestionCircleOutlined"
			tooltip="When disabled, this key cannot be used for API requests. Re-enable it to restore access."
			><UiSwitch :model-value="!draft.blocked" label="Enabled" @update:model-value="draft.blocked = !$event">{{
				draft.blocked ? "Disabled" : "Enabled"
			}}</UiSwitch></KeyFieldComponent
		>
		<KeyFormFields v-model="draft" :fields="fields" :errors="errors" editing />
		<KeyAccessFields v-model="draft" :catalog="catalog" />
		<KeyFieldComponent
			label="Organization"
			tooltip="The organization this key belongs to. Selecting an organization filters the available teams."
			><UiSelect
				:model-value="draft.organization_id || null"
				:options="
					catalog.organizations.map((org) => ({
						value: org.organization_id,
						label: org.organization_alias || org.organization_id,
					}))
				"
				:disabled="auth.userRole.value !== 'Admin'"
				clearable
				placeholder="All Organizations"
				@update:model-value="organization"
		/></KeyFieldComponent>
		<KeyFieldComponent
			label="Team ID"
			:help="
				catalog.uiSettings.enable_projects_ui && keyData.project_id
					? 'Team is locked because this key belongs to a project'
					: undefined
			"
			><UiSelect
				:model-value="draft.team_id || null"
				:options="teams"
				searchable
				:disabled="Boolean(catalog.uiSettings.enable_projects_ui && keyData.project_id)"
				placeholder="Select team"
				@update:model-value="selectTeam"
		/></KeyFieldComponent>
		<KeyFieldComponent v-if="catalog.uiSettings.enable_projects_ui && keyData.project_id" label="Project"
			><UiInput
				:model-value="
					catalog.projects.find((project) => project.project_id === keyData.project_id)?.project_alias
						? catalog.projects.find((project) => project.project_id === keyData.project_id)?.project_alias +
							' (' +
							keyData.project_id +
							')'
						: keyData.project_id
				"
				disabled
		/></KeyFieldComponent>
		<KeyFieldComponent label="Logging Settings"><KeyLoggingFields v-model="draft" /></KeyFieldComponent>
		<KeyFieldComponent label="Metadata" name="metadataText" :error="errors.metadataText"
			><UiInput
				:id="fieldId('metadataText')"
				:model-value="draft.metadataText"
				multiline
				:rows="10"
				@update:model-value="draft.metadataText = selectedString($event)"
		/></KeyFieldComponent>
		<KeyLifecycleFields v-model="draft" :errors="errors" />
		<footer class="vk-edit-footer">
			<UiButton appearance="tremor" :disabled="pending" @click="emit('cancel')">Cancel</UiButton
			><UiButton type="submit" appearance="tremor" variant="primary" :loading="pending">Save Changes</UiButton>
		</footer>
	</form>
</template>
