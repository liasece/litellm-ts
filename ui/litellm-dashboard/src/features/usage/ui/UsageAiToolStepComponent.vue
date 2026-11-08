<script setup lang="ts">
import { createTextVNode } from "vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import type { UsageAiToolStep } from "../support/UsageAiModels";
const props = defineProps<{ step: UsageAiToolStep }>();
const icons: Record<string, string> = { get_usage_data: "📊", get_team_usage_data: "👥", get_tag_usage_data: "🏷️" };
const ToolLabelContent = () => [
	createTextVNode(icons[props.step.tool_name] || "🔧"),
	createTextVNode(" "),
	createTextVNode(props.step.tool_label),
];
</script>
<template>
	<div class="usage-ai-tool-step">
		<span class="usage-ai-tool-status"
			><UiSpinner v-if="step.status === 'running'" :size="14" /><span
				v-else
				:class="step.status === 'error' ? 'usage-ai-tool-error' : 'usage-ai-tool-complete'"
				>{{ step.status === "error" ? "✗" : "✓" }}</span
			></span
		>
		<div>
			<div class="usage-ai-tool-label"><ToolLabelContent /></div>
			<p v-if="step.arguments.start_date && step.arguments.end_date">
				{{ step.arguments.start_date }} → {{ step.arguments.end_date }}
			</p>
			<p v-if="step.arguments.team_ids || step.arguments.tags || step.arguments.user_id">
				Filter: {{ step.arguments.team_ids || step.arguments.tags || step.arguments.user_id }}
			</p>
			<p v-if="step.status === 'error' && step.error" class="usage-ai-tool-error-text">{{ step.error }}</p>
		</div>
	</div>
</template>
