<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import { copyToolText } from "../support/ToolClipboardSupport";
const props = defineProps<{ code: string; title?: string }>();
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
async function copy() {
	if (await copyToolText(props.code)) {
		copied.value = true;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => (copied.value = false), 2000);
	}
}
onBeforeUnmount(() => {
	if (timer) clearTimeout(timer);
});
</script>
<template>
	<div class="tools-mcp-code-block">
		<label v-if="title"
			><UiLucideIcon name="Code" :size="16" /><strong>{{ title }}</strong></label
		><UiCard appearance="antd"
			><UiButton variant="text" size="small" aria-label="Copy code" :class="{ copied }" @click="copy"
				><UiLucideIcon :name="copied ? 'Check' : 'Copy'" :size="12"
			/></UiButton>
			<pre>{{ code }}</pre>
		</UiCard>
	</div>
</template>
