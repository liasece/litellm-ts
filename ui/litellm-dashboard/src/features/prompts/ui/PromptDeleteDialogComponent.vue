<script setup lang="ts">
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
const open = defineModel<boolean>("open", { required: true });
defineProps<{ promptId: string; pending: boolean }>();
const emit = defineEmits<{ confirm: [] }>();
</script>
<template>
	<UiDialog v-model:open="open" title="Delete Prompt" scroll-mode="overlay" class="prompt-delete-dialog"
		><p>
			Are you sure you want to delete prompt: <strong>{{ promptId }}</strong
			>?
		</p>
		<p>This action cannot be undone.</p>
		<template #footer
			><UiButton @click="open = false">Cancel</UiButton
			><UiButton variant="primary" danger :loading="pending" @click="emit('confirm')">Delete</UiButton></template
		></UiDialog
	>
</template>
