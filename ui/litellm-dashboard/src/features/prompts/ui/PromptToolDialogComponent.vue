<script setup lang="ts">
import { ref } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import { defaultPromptToolJson } from "../data/PromptDefaults";
const props = defineProps<{ initialJson?: string }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ save: [json: string] }>();
const json = ref(props.initialJson || defaultPromptToolJson),
	error = ref("");
function save() {
	try {
		JSON.parse(json.value);
		error.value = "";
		emit("save", json.value);
	} catch {
		error.value = "Invalid JSON format. Please check your syntax.";
	}
}
</script>
<template>
	<UiDialog v-model:open="open" title="Add Tool" :width="800" scroll-mode="overlay" class="prompt-tool-dialog"
		><div v-if="error" class="prompt-tool-json-error">{{ error }}</div>
		<textarea v-model="json" placeholder="Paste your tool JSON here..." /><template #footer
			><UiButton @click="open = false">Cancel</UiButton><UiButton variant="primary" @click="save">Add</UiButton></template
		></UiDialog
	>
</template>
