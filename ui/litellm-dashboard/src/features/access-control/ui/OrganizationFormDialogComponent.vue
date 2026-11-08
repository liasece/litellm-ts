<script setup lang="ts">
import { ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import OrganizationFieldsComponent from "./OrganizationFieldsComponent.vue";
import { organizationDraft } from "../logic/ResourceDraftLogic";
import type { AccessCatalog, AccessRecord } from "../support/AccessModels";
const props = defineProps<{ open: boolean; catalog: AccessCatalog; pending?: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean]; submit: [draft: AccessRecord] }>();
const draft = ref(organizationDraft()),
	errors = ref<Record<string, string>>({});
watch(
	() => props.open,
	(open) => {
		if (open) {
			draft.value = organizationDraft();
			errors.value = {};
		}
	},
);
function submit() {
	errors.value = draft.value.organization_alias ? {} : { organization_alias: "Please input an organization name" };
	if (!Object.keys(errors.value).length) emit("submit", { ...draft.value });
}
</script>
<template>
	<UiDialog
		class="access-create-horizontal access-organization-create-dialog"
		scroll-mode="overlay"
		:open="open"
		title="Create Organization"
		:width="800"
		:show-footer="false"
		@update:open="emit('update:open', $event)"
		><form @submit.prevent="submit">
			<OrganizationFieldsComponent v-model="draft" :catalog="catalog" :errors="errors" />
			<footer class="access-form-footer">
				<UiButton appearance="tremor" variant="primary" type="submit" :loading="pending">Create Organization</UiButton>
			</footer>
		</form></UiDialog
	>
</template>
