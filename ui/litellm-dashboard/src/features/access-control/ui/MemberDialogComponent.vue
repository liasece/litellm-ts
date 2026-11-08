<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiFormField from "../../platform/ui/UiFormField.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import AccessFieldComponent from "./AccessFieldComponent.vue";
import AccessNoticeComponent from "./AccessNoticeComponent.vue";
import { createMemberEditorStore } from "../stores/MemberEditorStore";
import type { AccessMember } from "../support/AccessModels";
const props = defineProps<{ open: boolean; member?: AccessMember | null; organization?: boolean; teamId?: string; pending?: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean]; submit: [member: AccessMember] }>();
const store = createMemberEditorStore(props.teamId),
	{ state } = store;
const roles = computed(() =>
	props.organization
		? [
				{
					value: "org_admin",
					label: props.member ? "Org Admin" : "org_admin - Can add and remove members, and change their roles.",
					description: "Can add and remove members, and change their roles.",
				},
				{
					value: "internal_user",
					label: props.member ? "Internal User" : "internal_user - Can view/create keys for themselves within organization.",
					description: "Can view/create keys for themselves within organization.",
				},
				{
					value: "internal_user_viewer",
					label: props.member ? "Internal User Viewer" : "internal_user_viewer - Can only view their keys within organization.",
					description: "Can only view their keys within organization.",
				},
			]
		: [
				{
					value: "admin",
					label: props.member ? "Admin" : "admin - Admin role. Can create team keys, add members, and manage settings.",
					description: "Admin role. Can create team keys, add members, and manage settings.",
				},
				{
					value: "user",
					label: props.member ? "User" : "user - User role. Can view team info, but not manage it.",
					description: "User role. Can view team info, but not manage it.",
				},
			],
);
watch(
	() => props.open,
	(open) => {
		if (open) store.reset(props.member ?? undefined, props.organization ? "internal_user" : "user");
	},
);
onBeforeUnmount(store.dispose);
function submit() {
	state.error = "";
	if (!state.draft.role) {
		state.error = "Please select a role!";
		return;
	}
	if (props.member && state.draft.user_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.draft.user_email)) {
		state.error = "Please enter a valid email!";
		return;
	}
	emit(
		"submit",
		Object.fromEntries(
			Object.entries(state.draft).map(([name, value]) => [name, typeof value === "string" ? value.trim() : value]),
		) as AccessMember,
	);
}
</script>
<template>
	<UiDialog
		scroll-mode="overlay"
		:class="{ 'access-member-edit-dialog': !!member, 'access-member-add-dialog': !member }"
		:open="open"
		:title="member ? 'Edit Member' : organization ? 'Add Organization Member' : 'Add Team Member'"
		:width="member ? 1000 : 800"
		:show-footer="false"
		:mask-closable="!pending"
		@update:open="emit('update:open', $event)"
		><AccessNoticeComponent :error="state.error" />
		<form class="access-member-form" @submit.prevent="submit">
			<template v-if="member"
				><AccessFieldComponent
					v-model="state.draft.user_email"
					input-appearance="tremor"
					name="member-email"
					label="Email"
					placeholder="user@example.com"
					horizontal />
				<p class="access-member-or">OR</p>
				<AccessFieldComponent
					v-model="state.draft.user_id"
					input-appearance="tremor"
					name="member-id"
					label="User ID"
					placeholder="user_123"
					horizontal /></template
			><template v-else
				><UiFormField label="Email" for="member-search-email" horizontal
					><UiSelect
						id="member-search-email"
						:model-value="state.draft.user_email"
						:options="
							state.field === 'user_email'
								? state.options.map((user) => ({
										value: user.user_email || user.user_id,
										label: user.user_email || user.user_id,
									}))
								: []
						"
						searchable
						:filterable="false"
						:loading="state.loading"
						clearable
						placeholder="Search by email"
						@search="store.search($event, 'user_email')"
						@update:model-value="store.select"
				/></UiFormField>
				<p class="access-member-or">OR</p>
				<UiFormField label="User ID" for="member-search-id" horizontal
					><UiSelect
						id="member-search-id"
						:model-value="state.draft.user_id"
						:options="
							state.field === 'user_id' ? state.options.map((user) => ({ value: user.user_id, label: user.user_id })) : []
						"
						searchable
						:filterable="false"
						:loading="state.loading"
						clearable
						placeholder="Search by user ID"
						@search="store.search($event, 'user_id')"
						@update:model-value="store.select" /></UiFormField
			></template>
			<UiFormField :label="member ? 'Role' : 'Member Role'" for="member-role" :required="!!member" horizontal
				><template v-if="member" #label
					><span class="access-member-role-label"
						><span>Role</span
						><span>(Current: {{ roles.find((role) => role.value === member?.role)?.label || member?.role }})</span></span
					></template
				><UiSelect id="member-role" v-model="state.draft.role" :options="roles" /></UiFormField
			><template v-if="member && !organization"
				><AccessFieldComponent
					v-model="state.draft.max_budget_in_team"
					input-appearance="tremor"
					name="member-budget"
					label="Team Member Budget (USD)"
					tooltip-icon="InfoCircleOutlined"
					tooltip="Maximum amount in USD this member can spend within this team. This is separate from any global user budget limits"
					type="number"
					:min="0"
					:step="0.01"
					placeholder="Budget limit for this member within this team"
					horizontal /><AccessFieldComponent
					v-model="state.draft.tpm_limit"
					input-appearance="tremor"
					name="member-tpm"
					label="Team Member TPM Limit"
					:step="1"
					tooltip-icon="InfoCircleOutlined"
					tooltip="Maximum tokens per minute this member can use within this team. This is separate from any global user TPM limit"
					type="number"
					:min="0"
					placeholder="Tokens per minute limit for this member in this team"
					horizontal /><AccessFieldComponent
					v-model="state.draft.rpm_limit"
					input-appearance="tremor"
					name="member-rpm"
					label="Team Member RPM Limit"
					:step="1"
					tooltip-icon="InfoCircleOutlined"
					tooltip="Maximum requests per minute this member can make within this team. This is separate from any global user RPM limit"
					type="number"
					:min="0"
					placeholder="Requests per minute limit for this member in this team"
					horizontal
			/></template>
			<footer class="access-form-footer">
				<UiButton v-if="member" :disabled="pending" @click="emit('update:open', false)">Cancel</UiButton
				><UiButton :variant="member ? 'default' : 'primary'" type="submit" :loading="pending"
					><template v-if="!member" #icon><UiIcon name="UserAddOutlined" /></template
					>{{ member ? "Save Changes" : "Add Member" }}</UiButton
				>
			</footer>
		</form></UiDialog
	>
</template>
