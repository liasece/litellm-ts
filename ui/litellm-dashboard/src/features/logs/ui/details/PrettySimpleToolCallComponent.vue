<script setup lang="ts">
import type { MessagePart, ToolCall } from "../../support/PrettyMessagesModels";
import { computed } from "vue";
import { safeJsonStringify } from "../../logic/PrettyMessagesBlocksLogic";
import PrivacyPlaceholderText from "../../../content/ui/PrivacyPlaceholderText.vue";
const props = withDefaults(defineProps<{ tool: ToolCall; compact?: boolean; badge?: string; result?: MessagePart }>(), {
	compact: false,
	badge: "Function call",
	result: undefined,
});
const resultText = computed(() =>
	props.result ? props.result.text || (props.result.data !== undefined ? safeJsonStringify(props.result.data, true) : "（空输出）") : "",
);
</script>
<template>
	<div class="pretty-tool" :class="{ 'pretty-tool--compact': compact }">
		<div class="pretty-tool__badge">{{ badge }}</div>
		<strong class="pretty-tool__name">{{ tool.name }}</strong>
		<div v-for="(value, key) in tool.arguments" :key="key" class="pretty-tool__argument">
			<span class="ld-secondary">{{ key }}: </span><PrivacyPlaceholderText :text="safeJsonStringify(value)" />
		</div>
		<div
			v-if="result"
			class="pretty-tool__result"
			:class="{ 'pretty-tool__result--error': result.isError }"
			:data-tool-output-for="tool.id"
		>
			<div class="pretty-tool__result-heading">
				<span>工具输出</span><span v-if="result.status">{{ result.status }}</span>
			</div>
			<slot name="result">
				<pre :style="{ maxHeight: compact ? '180px' : '320px' }"><PrivacyPlaceholderText :text="resultText" /></pre>
			</slot>
		</div>
	</div>
</template>
