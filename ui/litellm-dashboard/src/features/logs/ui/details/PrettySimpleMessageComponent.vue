<script setup lang="ts">
import type { MessagePart, ToolCall } from "../../support/PrettyMessagesModels";
import PrettyMessagePartsComponent from "./PrettyMessagePartsComponent.vue";
import PrettySimpleToolCallComponent from "./PrettySimpleToolCallComponent.vue";
withDefaults(defineProps<{ label: string; content?: string; toolCalls?: ToolCall[]; parts?: MessagePart[]; compact?: boolean }>(), {
	content: undefined,
	toolCalls: undefined,
	parts: undefined,
	compact: false,
});
</script>
<template>
	<div v-if="(content && content !== 'null') || toolCalls?.length || parts?.length" :style="{ marginBottom: compact ? '8px' : 0 }">
		<span class="pretty-label pretty-label--block">{{ label }}</span
		><PrettyMessagePartsComponent v-if="parts?.length" :parts="parts" :compact="compact" />
		<div v-else-if="content && content !== 'null'" class="pretty-text" :style="{ marginBottom: toolCalls?.length ? '6px' : 0 }">
			{{ content }}
		</div>
		<template v-if="!parts?.length"
			><PrettySimpleToolCallComponent v-for="(tool, index) in toolCalls" :key="tool.id || index" :tool="tool" :compact="compact"
		/></template>
	</div>
</template>
