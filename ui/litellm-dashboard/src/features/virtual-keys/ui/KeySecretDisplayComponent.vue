<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
const props = defineProps<{ value: string }>();
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
async function copy() {
	await navigator.clipboard.writeText(props.value);
	copied.value = true;
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => {
		copied.value = false;
	}, 2000);
}
onBeforeUnmount(() => {
	if (timer) clearTimeout(timer);
});
</script>
<template>
	<div class="vk-secret-display">
		<h2 class="vk-tremor-title">Save your Key</h2>
		<p>
			Please save this secret key somewhere safe and accessible. For security reasons,
			<b>you will not be able to view it again</b> through your LiteLLM account. If you lose this secret key, you will need to
			generate a new one.
		</p>
		<p class="vk-secret-label">Virtual Key:</p>
		<div class="vk-secret-value">
			<pre>{{ value }}</pre>
		</div>
		<UiButton variant="primary" @click="copy">{{ copied ? "Copied!" : "Copy Virtual Key" }}</UiButton>
	</div>
</template>
