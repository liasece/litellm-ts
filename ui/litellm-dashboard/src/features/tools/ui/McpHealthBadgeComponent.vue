<script setup lang="ts">
import { computed, ref } from "vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import type { MCPServer } from "../support/McpModels";
const props = defineProps<{ server: MCPServer; loading?: boolean }>();
const emit = defineEmits<{ recheck: [] }>();
const hovered = ref(false),
	status = computed(() => props.server.status || "unknown");
const title = computed(() =>
	[
		"Health Status: " + status.value,
		props.server.last_health_check ? "Last Check: " + new Date(props.server.last_health_check).toLocaleString() : "",
		props.server.health_check_error ? "Error: " + props.server.health_check_error : "",
		!props.server.last_health_check && !props.server.health_check_error ? "No health check data available" : "",
		"Click to recheck",
	]
		.filter(Boolean)
		.join("\n"),
);
</script>
<template>
	<span v-if="loading" class="tools-mcp-health tools-mcp-health--checking"><i />Checking</span
	><UiTooltip v-else :title="title"
		><button
			type="button"
			:class="['tools-mcp-health', 'tools-mcp-health--' + status]"
			@mouseenter="hovered = true"
			@mouseleave="hovered = false"
			@click="emit('recheck')"
		>
			<span>{{ hovered ? "↻" : status === "healthy" ? "✓" : status === "unhealthy" ? "✗" : "?" }}</span
			>{{ hovered ? "Recheck" : status.charAt(0).toUpperCase() + status.slice(1) }}
		</button></UiTooltip
	>
</template>
