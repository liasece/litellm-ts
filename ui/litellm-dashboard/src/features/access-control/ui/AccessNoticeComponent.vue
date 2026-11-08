<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
const props = defineProps<{ error?: string; message?: string }>();
const visible = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
	() => props.message,
	(message) => {
		if (timer) clearTimeout(timer);
		visible.value = Boolean(message);
		if (message)
			timer = setTimeout(() => {
				visible.value = false;
			}, 3000);
	},
	{ immediate: true },
);
onBeforeUnmount(() => {
	if (timer) clearTimeout(timer);
});
</script>
<template>
	<UiAlert v-if="error" type="error" :title="error" class="access-notice" />
	<div v-if="message && visible" role="status" class="access-success">{{ message }}</div>
</template>
