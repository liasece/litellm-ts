<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiFormField from "../../platform/ui/UiFormField.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import AccessNoticeComponent from "./AccessNoticeComponent.vue";
import { createMemberEditorStore } from "../stores/MemberEditorStore";
import type { AccessMember } from "../support/AccessModels";
const props = defineProps<{ open: boolean; organization?: boolean; pending?: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean]; submit: [member: AccessMember] }>();
const store = createMemberEditorStore(),
	{ state } = store;
const roles = props.organization
	? [
			{ value: "org_admin", label: "org_admin - Can add and remove members, and change their roles." },
			{ value: "internal_user", label: "internal_user - Can view/create keys for themselves within organization." },
			{ value: "internal_user_viewer", label: "internal_user_viewer - Can only view their keys within organization." },
		]
	: [
			{ value: "admin", label: "admin - Admin role. Can create team keys, add members, and manage settings." },
			{ value: "user", label: "user - User role. Can view team info, but not manage it." },
		];
watch(
	() => props.open,
	(open) => {
		if (open) store.reset(undefined, props.organization ? "internal_user" : "user");
	},
);
onBeforeUnmount(store.dispose);
function submit() {
	state.error = "";
	if (!state.draft.role) {
		state.error = "Please select a role!";
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
		class="access-member-add-dialog"
		:open="open"
		:title="organization ? 'Add Organization Member' : 'Add Team Member'"
		:width="800"
		:show-footer="false"
		:mask-closable="!pending"
		@update:open="emit('update:open', $event)"
		><AccessNoticeComponent :error="state.error" />
		<form class="access-member-form" @submit.prevent="submit">
			<UiFormField label="Email" for="member-search-email" horizontal
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
					:options="state.field === 'user_id' ? state.options.map((user) => ({ value: user.user_id, label: user.user_id })) : []"
					searchable
					:filterable="false"
					:loading="state.loading"
					clearable
					placeholder="Search by user ID"
					@search="store.search($event, 'user_id')"
					@update:model-value="store.select"
			/></UiFormField>
			<UiFormField label="Member Role" for="member-role" required horizontal
				><UiSelect id="member-role" v-model="state.draft.role" :options="roles"
			/></UiFormField>
			<footer class="access-form-footer">
				<UiButton :disabled="pending" @click="emit('update:open', false)">Cancel</UiButton
				><UiButton variant="primary" type="submit" :loading="pending"
					><template #icon><UiIcon name="UserAddOutlined" /></template>Add Member</UiButton
				>
			</footer>
		</form></UiDialog
	>
</template>
