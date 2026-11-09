<script setup lang="ts">
import { ref } from "vue";
import UiButton from "../../src/features/platform/ui/UiButton.vue";
import UiDialog from "../../src/features/platform/ui/UiDialog.vue";
import KeySecretDisplay from "../../src/features/virtual-keys/ui/KeySecretDisplayComponent.vue";
const open = ref(false);
</script>
<template>
	<UiButton @click="open = true">Open key dialog</UiButton>
	<UiDialog v-model:open="open" title="Save your Key" :show-footer="false">
		<KeySecretDisplay value="sk-dialog-secret" />
	</UiDialog>
</template>
