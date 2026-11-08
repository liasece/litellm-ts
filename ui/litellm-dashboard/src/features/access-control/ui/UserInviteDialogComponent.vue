<script setup lang="ts">
import UiIcon from "../../platform/ui/UiIcon.vue";
import { ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import AccessFieldComponent from "./AccessFieldComponent.vue";
import type { AccessCatalog, AccessRecord } from "../support/AccessModels";
const props = defineProps<{ open: boolean; catalog: AccessCatalog; pending?: boolean; resetKey?: number }>(),
	emit = defineEmits<{ "update:open": [value: boolean]; submit: [value: AccessRecord] }>();
const draft = ref<AccessRecord>({});
watch(
	() => [props.open, props.resetKey],
	() => {
		draft.value = {};
	},
);
</script>
<template>
	<UiDialog
		class="access-create-horizontal access-user-invite-dialog"
		scroll-mode="overlay"
		:open="open"
		title="Invite User"
		:width="800"
		:show-footer="false"
		@update:open="emit('update:open', $event)"
		><div class="access-invite-intro">
			<p>Create a User who can own keys</p>
			<UiAlert title="Email invitations"
				><p>
					New users receive an email invite only when an email integration (SMTP, Resend, or SendGrid) is configured.
					<a href="https://docs.litellm.ai/docs/proxy/email" target="_blank" rel="noopener noreferrer"
						>Learn how to set up email notifications</a
					>
				</p></UiAlert
			>
		</div>
		<form @submit.prevent="emit('submit', { ...draft })">
			<AccessFieldComponent v-model="draft.user_email" name="invite-user-email" label="User Email" horizontal /><AccessFieldComponent
				v-model="draft.user_role"
				name="invite-user-role"
				placeholder=""
				label="Global Proxy Role"
				tooltip="This role is independent of any team/org specific roles. Configure Team / Organization Admins in the Settings"
				tooltip-icon="InfoCircleOutlined"
				type="select"
				:options="
					Object.entries(catalog.roles).map(([value, role]) => ({ value, label: role.ui_label, description: role.description }))
				"
				horizontal
			/><AccessFieldComponent
				v-model="draft.team_id"
				name="invite-user-team"
				placeholder="Search or select a team"
				label="Team"
				type="select"
				:options="catalog.teams.map((team) => ({ value: team.team_id, label: team.team_alias || team.team_id }))"
				help="If selected, user will be added as a 'user' role to the team."
				horizontal
			/><AccessFieldComponent
				v-model="draft.organization_ids"
				name="invite-user-organizations"
				label="Organization"
				type="select"
				multiple
				:options="
					catalog.organizations.map((org) => ({
						value: org.organization_id,
						label: org.organization_alias + ' (' + org.organization_id + ')',
					}))
				"
				placeholder="Select Organization"
				help="The user will be added to the selected organization(s)."
				horizontal
			/><AccessFieldComponent
				v-model="draft.metadata"
				name="invite-user-metadata"
				label="Metadata"
				type="textarea"
				placeholder="Enter metadata as JSON"
				horizontal
			/>
			<details class="access-invite-personal">
				<summary><b>Personal Key Creation</b><UiLucideIcon name="ChevronDown" :size="12" /></summary>
				<div>
					<AccessFieldComponent
						v-model="draft.models"
						name="invite-user-models"
						label="Models"
						type="select"
						multiple
						:options="[
							{ value: 'all-proxy-models', label: 'All Proxy Models' },
							{ value: 'no-default-models', label: 'No Default Models' },
							...catalog.models,
						]"
						placeholder="Select models"
						help="Models user has access to, outside of team scope."
						horizontal
					/>
				</div>
			</details>
			<footer class="access-form-footer">
				<UiButton variant="primary" type="submit" :loading="pending"
					><template #icon><UiIcon name="UserAddOutlined" /></template>Invite User</UiButton
				>
			</footer>
		</form></UiDialog
	>
</template>
