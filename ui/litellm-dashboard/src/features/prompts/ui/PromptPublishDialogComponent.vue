<script setup lang="ts">
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiInput from "../../platform/ui/UiInput.vue";
const open = defineModel<boolean>("open", { required: true }),
	name = defineModel<string>("name", { required: true });
defineProps<{ pending: boolean }>();
const emit = defineEmits<{ publish: [] }>();
</script>
<template>
	<UiDialog v-model:open="open" title="Publish Prompt" scroll-mode="overlay" class="prompt-publish-dialog"
		><label>Name</label><UiInput v-model="name" placeholder="Enter prompt name" autofocus @keydown.enter="emit('publish')" />
		<p>Published prompts can be used in API calls and are versioned for easy tracking.</p>
		<template #footer
			><UiButton appearance="tremor" @click="open = false">Cancel</UiButton
			><UiButton appearance="tremor" variant="primary" :loading="pending" @click="emit('publish')">Publish</UiButton></template
		></UiDialog
	>
</template>
