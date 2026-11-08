<script setup lang="ts">
import { provideKeyFormIdentity } from "../support/KeyFormIdentity";
import { computed, reactive, ref, watch } from "vue";
import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import { recordValue, selectedString, type KeyCatalog } from "../support/VirtualKeyModels";
import KeyField from "./KeyFieldComponent.vue";
const open = defineModel<boolean>("open", { required: true });
const props = defineProps<{ catalog: KeyCatalog }>();
const emit = defineEmits<{ created: [userId: string, email: string] }>();
const draft = reactive({ user_email: "", user_role: "", team_id: "", metadata: "" });
const pending = ref(false);
const error = ref("");
const roles = computed(() =>
	Object.entries(props.catalog.userRoles).map(([value, metadata]) => ({
		value,
		label: selectedString(recordValue(metadata).ui_label) || value,
		description: selectedString(recordValue(metadata).description),
	})),
);
watch(open, (value) => {
	if (value) {
		draft.user_email = "";
		draft.user_role = "";
		draft.team_id = "";
		draft.metadata = "";
		error.value = "";
	}
});
async function submit() {
	pending.value = true;
	error.value = "";
	try {
		const payload: Record<string, unknown> = {
			user_id: null,
			auto_create_key: false,
			user_email: draft.user_email || undefined,
			user_role: draft.user_role || undefined,
			team_id: draft.team_id || undefined,
			...(draft.user_role !== "proxy_admin" ? { models: ["no-default-models"] } : {}),
		};
		if (draft.metadata.trim()) payload.metadata = JSON.parse(draft.metadata);
		const result = await requestJson("/user/new", { method: "POST", body: JSON.stringify(payload) }, (value) =>
			z.record(z.string(), z.unknown()).parse(value),
		);
		const id = selectedString(recordValue(result.data).user_id ?? result.user_id);
		if (!id) throw new Error("User creation returned no user ID");
		emit("created", id, draft.user_email);
		open.value = false;
	} catch (reason: unknown) {
		error.value = reason instanceof Error ? reason.message : "Error creating the user";
	} finally {
		pending.value = false;
	}
}
const fieldId = provideKeyFormIdentity("key-owner-user");
</script>
<template>
	<UiDialog
		v-model:open="open"
		title="Create New User"
		scroll-mode="overlay"
		class="vk-owner-user-modal"
		:width="800"
		:show-footer="false"
		><form class="vk-create-form" @submit.prevent="submit">
			<UiAlert type="info" title="Email invitations" class="vk-email-invitations"
				>New users receive an email invite only when an email integration (SMTP, Resend, or SendGrid) is configured.
				<a href="https://docs.litellm.ai/docs/proxy/email" target="_blank" rel="noopener noreferrer"
					>Learn how to set up email notifications</a
				></UiAlert
			><UiAlert v-if="error" type="error">{{ error }}</UiAlert
			><KeyField label="User Email" name="user_email" horizontal
				><UiInput
					:id="fieldId('user_email')"
					:model-value="draft.user_email"
					appearance="tremor"
					@update:model-value="draft.user_email = selectedString($event)" /></KeyField
			><KeyField label="User Role" name="user_role" horizontal
				><UiSelect
					:id="fieldId('user_role')"
					:model-value="draft.user_role || null"
					:options="roles"
					@update:model-value="draft.user_role = selectedString($event)" /></KeyField
			><KeyField label="Team" name="team_id" horizontal
				><UiSelect
					:id="fieldId('team_id')"
					:model-value="draft.team_id || null"
					:options="catalog.teams.map((team) => ({ value: team.team_id, label: team.team_alias || team.team_id }))"
					searchable
					clearable
					@update:model-value="draft.team_id = selectedString($event)" /></KeyField
			><KeyField label="Metadata" name="metadata" horizontal
				><UiInput
					:id="fieldId('metadata')"
					:model-value="draft.metadata"
					multiline
					:rows="4"
					placeholder="Enter metadata as JSON"
					@update:model-value="draft.metadata = selectedString($event)"
			/></KeyField>
			<footer class="vk-form-submit"><UiButton type="submit" :loading="pending">Create User</UiButton></footer>
		</form></UiDialog
	>
</template>
