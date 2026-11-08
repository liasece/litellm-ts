<script setup lang="ts">
import { ref, watch } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiCheckbox from "../../platform/ui/UiCheckbox.vue";
import AccessFieldComponent from "./AccessFieldComponent.vue";
import AccessNoticeComponent from "./AccessNoticeComponent.vue";
import { all_admin_roles } from "../../identity/logic/UserRoleLogic";
import { createUserDraft, buildUserUpdatePayload } from "../logic/UserDraftLogic";
import { budgetDurationOptions } from "../support/TeamFields";
import type { AccessCatalog, AccessRecord, AccessUser } from "../support/AccessModels";
const props = defineProps<{ user?: AccessUser | null; catalog: AccessCatalog; role: string; bulk?: boolean; pending?: boolean }>();
const emit = defineEmits<{ cancel: []; submit: [value: AccessRecord] }>();
const draft = ref<AccessRecord>(
		props.bulk ? { models: [], user_role: "", max_budget: null, metadata: "{}" } : createUserDraft(props.user ?? undefined),
	),
	unlimited = ref(props.user?.max_budget == null),
	error = ref("");
watch(
	() => props.user,
	(value) => {
		draft.value = createUserDraft(value ?? undefined);
		unlimited.value = value?.max_budget == null;
		error.value = "";
	},
);
function submit() {
	error.value = "";
	if (!unlimited.value && draft.value.max_budget == null) {
		error.value = "Please enter a budget or select Unlimited Budget";
		return;
	}
	try {
		emit("submit", buildUserUpdatePayload(draft.value, unlimited.value));
	} catch (reason) {
		error.value = reason instanceof Error ? reason.message : "Invalid metadata";
	}
}
</script>
<template>
	<form class="access-user-edit-form" @submit.prevent="submit">
		<AccessNoticeComponent :error="error" /><template v-if="!bulk"
			><AccessFieldComponent
				input-appearance="tremor"
				v-model="draft.user_id"
				name="edit-user-id"
				label="User ID"
				disabled /><AccessFieldComponent
				input-appearance="tremor"
				v-model="draft.user_email"
				name="edit-user-email"
				label="Email" /></template
		><AccessFieldComponent
			input-appearance="tremor"
			v-model="draft.user_alias"
			name="edit-user-alias"
			label="User Alias"
			placeholder="Type..."
		/><AccessFieldComponent
			input-appearance="tremor"
			v-model="draft.user_role"
			name="edit-user-role"
			label="Global Proxy Role"
			placeholder=""
			:searchable="false"
			:clearable="false"
			show-option-description
			type="select"
			:options="
				Object.entries(catalog.roles).map(([value, role]) => ({ value, label: role.ui_label, description: role.description }))
			"
			><template #label
				>Global Proxy Role
				<UiTooltip
					title="This is the role that the user will globally on the proxy. This role is independent of any team/org specific roles."
					><UiIcon name="InfoCircleOutlined" /></UiTooltip></template></AccessFieldComponent
		><AccessFieldComponent
			input-appearance="tremor"
			v-model="draft.models"
			name="edit-user-models"
			label="Personal Models"
			type="select"
			multiple
			:disabled="!all_admin_roles.includes(role)"
			:options="[
				{ value: 'all-proxy-models', label: 'All Proxy Models' },
				{ value: 'no-default-models', label: 'No Default Models' },
				...catalog.models,
			]"
			placeholder="Select models"
			:searchable="false"
			:clearable="false"
			><template #label
				>Personal Models
				<UiTooltip
					title="Select which models this user can access outside of team-scope. Choose 'All Proxy Models' to grant access to all models available on the proxy."
					><UiIcon name="InfoCircleOutlined" class="access-user-model-info" /></UiTooltip></template
		></AccessFieldComponent>
		<div class="access-budget-label">
			<span>Max Budget (USD)</span
			><UiCheckbox v-model="unlimited" label="Unlimited Budget" @update:model-value="$event && (draft.max_budget = null)"
				>Unlimited Budget</UiCheckbox
			>
		</div>
		<AccessFieldComponent
			input-appearance="tremor"
			v-model="draft.max_budget"
			name="edit-user-budget"
			:precision="2"
			placeholder="Enter a numerical value"
			type="number"
			:step="0.01"
			:disabled="unlimited"
		/><AccessFieldComponent
			input-appearance="tremor"
			v-model="draft.budget_duration"
			name="edit-user-duration"
			label="Reset Budget"
			:searchable="false"
			:clearable="false"
			type="select"
			:options="budgetDurationOptions"
			placeholder="n/a"
		/><AccessFieldComponent
			input-appearance="tremor"
			v-model="draft.metadata"
			name="edit-user-metadata"
			label="Metadata"
			type="textarea"
			placeholder="Enter metadata as JSON"
		/>
		<footer class="access-form-footer">
			<UiButton appearance="tremor" :disabled="pending" @click="emit('cancel')">Cancel</UiButton
			><UiButton appearance="tremor" variant="primary" type="submit" :loading="pending">Save Changes</UiButton>
		</footer>
	</form>
</template>
