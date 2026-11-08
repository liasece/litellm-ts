<script setup lang="ts">
import { ref, onBeforeUnmount } from "vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
const props = withDefaults(defineProps<{ text: string; label?: string; disabled?: boolean }>(), { label: "Copy", disabled: false });
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
async function copy() {
	try {
		await navigator.clipboard.writeText(props.text);
		copied.value = true;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => (copied.value = false), 3000);
	} catch {
		copied.value = false;
	}
}
onBeforeUnmount(() => {
	if (timer) clearTimeout(timer);
});
</script>
<template>
	<button
		type="button"
		class="ld-copy"
		:title="copied ? 'Copied!' : label"
		:aria-label="copied ? 'Copied!' : label"
		:disabled="disabled"
		@click.stop="copy"
	>
		<UiIcon :name="copied ? 'CheckOutlined' : 'CopyOutlined'" />
	</button>
</template>
