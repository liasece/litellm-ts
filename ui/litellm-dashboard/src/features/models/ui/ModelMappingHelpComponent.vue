<script setup lang="ts">
import { ref } from "vue";
import UiPopover from "../../platform/ui/UiPopover.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
defineProps<{ kind: "public" | "litellm" }>();
const placement = ref<"top" | "bottom">("top");
function place(event: MouseEvent | FocusEvent) {
	const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
	placement.value = box.top < 300 && window.innerHeight - box.bottom > 300 ? "bottom" : "top";
}
</script>
<template>
	<div class="model-mapping-help" @mouseenter="place" @focusin="place">
		<UiPopover
			dark
			:placement="placement"
			:popup-class="'model-mapping-help-popup model-mapping-help-popup--' + kind + ' model-mapping-help-popup--' + placement"
		>
			<UiIcon name="QuestionCircleOutlined" />
			<template #content>
				<template v-if="kind === 'public'">
					<div class="model-mapping-help-paragraph">The name you specify in your API calls to LiteLLM Proxy</div>
					<div class="model-mapping-help-paragraph">
						<strong>Example:</strong> If you name your public model <code>example-name</code>, and choose
						<code>openai/qwen-plus-latest</code> as the LiteLLM model
					</div>
					<div class="model-mapping-help-paragraph">
						<strong>Usage:</strong> You make an API call to the LiteLLM proxy with <code>model = "example-name"</code>
					</div>
					<div><strong>Result:</strong> LiteLLM sends <code>qwen-plus-latest</code> to the provider</div>
				</template>
				<div v-else>The model name LiteLLM will send to the LLM API</div>
			</template>
		</UiPopover>
	</div>
</template>
<style scoped>
.model-mapping-help {
	position: relative;
	display: inline-block;
	cursor: help;
}
.model-mapping-help :deep(.ui-popover-anchor) {
	display: inline-block;
	line-height: 22px;
	vertical-align: baseline;
}
.model-mapping-help :deep(.ui-icon) {
	margin-left: 4px;
	color: #6b7280;
}
</style>
