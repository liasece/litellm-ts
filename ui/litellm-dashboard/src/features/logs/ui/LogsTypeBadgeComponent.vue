<script setup lang="ts">
import { computed } from "vue";
import { MCP_CALL_TYPES, AGENT_CALL_TYPES } from "../support/LogsConstants";
const props = defineProps<{ callType?: string | null; count?: number | null }>();
const type = computed(() =>
	MCP_CALL_TYPES.includes(props.callType || "") ? "mcp" : AGENT_CALL_TYPES.includes(props.callType || "") ? "agent" : "llm",
);
</script>
<template>
	<span class="logs-type-badge" :class="'logs-type-' + type">
		<svg
			:width="type === 'mcp' ? 10 : 12"
			:height="type === 'mcp' ? 10 : 12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path
				v-if="type === 'llm'"
				style="color: #9ca3af"
				d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z"
			/>
			<path
				v-else-if="type === 'mcp'"
				d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
			/>
			<template v-else>
				<path d="M12 8V4H8" />
				<rect width="16" height="12" x="4" y="8" rx="2" />
				<path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
			</template></svg
		>{{ count && count > 1 ? count : type === "mcp" ? "MCP" : type === "agent" ? "Agent" : "LLM" }}
	</span>
</template>
<style>
.logs-type-badge {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px 8px;
	border: 1px solid #bfdbfe;
	border-radius: 9999px;
	background: #eff6ff;
	color: #1d4ed8;
	font-size: 11px;
	font-weight: 500;
	white-space: nowrap;
}
.logs-type-mcp {
	border-color: #fde68a;
	background: #fffbeb;
	color: #b45309;
}
.logs-type-agent {
	border-color: #ddd6fe;
	background: #f5f3ff;
	color: #6d28d9;
}
.logs-type-badge svg {
	flex-shrink: 0;
}
</style>
