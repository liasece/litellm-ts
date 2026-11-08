<script setup lang="ts">
import { ref } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { createPromptUploadStore } from "../stores/PromptUploadStore";
const open = defineModel<boolean>("open", { required: true }),
	emit = defineEmits<{ saved: [] }>(),
	auth = useAuthenticationStore(),
	store = createPromptUploadStore(() => auth.isAuthorized.value),
	{ state, file, error } = store,
	input = ref<HTMLInputElement>();
function cancel() {
	store.reset();
	open.value = false;
}
function choose(event: Event) {
	const control = event.target as HTMLInputElement,
		value = control.files?.[0];
	if (value) store.choose(value);
	control.value = "";
}
async function save() {
	if (await store.save()) {
		open.value = false;
		emit("saved");
	}
}
</script>
<template>
	<UiDialog
		:open="open"
		title="Add New Prompt"
		:width="600"
		scroll-mode="overlay"
		class="prompt-upload-dialog"
		@update:open="
			(value) => {
				if (!value) cancel();
			}
		"
		><div class="prompt-upload-field">
			<label>Prompt ID</label
			><UiInput v-model="state.id" appearance="tremor" placeholder="Enter unique prompt ID (e.g., my_prompt_id)" /><small
				v-if="error"
				class="prompt-field-error"
				role="alert"
				>{{ error }}</small
			>
		</div>
		<div class="prompt-upload-field">
			<label>Prompt Integration</label
			><UiSelect v-model="state.integration" :options="[{ value: 'dotprompt', label: 'dotprompt' }]" />
		</div>
		<hr />
		<div class="prompt-upload-field">
			<label>Prompt File</label><input ref="input" hidden type="file" @change="choose" /><UiButton @click="input?.click()"
				><UiIcon name="UploadOutlined" />Select .prompt File</UiButton
			>
			<div v-if="file" class="prompt-upload-file">
				<UiIcon name="PaperClipOutlined" /><span>{{ file.name }}</span
				><button type="button" aria-label="Remove file" @click="file = null"><UiIcon name="DeleteOutlined" /></button>
			</div>
			<p v-if="file" class="prompt-selected-file">Selected: {{ file.name }}</p>
			<small>Upload a .prompt file that follows the Dotprompt specification</small>
		</div>
		<template #footer
			><UiButton @click="cancel">Cancel</UiButton><UiButton :loading="state.loading" @click="save">Create Prompt</UiButton></template
		></UiDialog
	>
</template>
