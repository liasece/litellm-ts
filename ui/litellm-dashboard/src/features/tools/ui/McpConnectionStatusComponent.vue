<script setup lang="ts">
import UiCard from "../../platform/ui/UiCard.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import type { createMcpConnectionStore } from "../stores/McpConnectionStore";
defineProps<{ connection: ReturnType<typeof createMcpConnectionStore>; values: Record<string, unknown> }>();
</script>
<template>
	<UiCard v-if="connection.canFetch.value || values.url || values.spec_path" class="tools-mcp-connection-status"
		><h3><UiIcon name="CheckCircleOutlined" :size="14" />Connection Status</h3>
		<div v-if="!connection.canFetch.value" class="tools-mcp-dashed-empty">
			<UiIcon name="ToolOutlined" :size="24" />
			<p>Complete required fields to test connection</p>
			<small>Fill in URL, Transport, and Authentication to test MCP server connection</small>
		</div>
		<template v-else
			><header>
				<div>
					<p class="tools-mcp-connection-message">
						{{
							connection.loading.value
								? "Testing connection to MCP server..."
								: connection.tools.value.length
									? "Connection successful"
									: connection.error.value
										? "Connection failed"
										: "Ready to test connection"
						}}
					</p>
					<br />
					<p class="tools-mcp-connection-server">Server: {{ values.url || values.spec_path }}</p>
				</div>
				<span v-if="connection.loading.value" class="tools-mcp-blue">Connecting...</span
				><span v-else-if="connection.error.value" class="tools-error"><UiIcon name="ExclamationCircleOutlined" />Failed</span
				><span v-else-if="connection.tools.value.length" class="tools-success"
					><UiIcon name="CheckCircleOutlined" :size="14" />Connected</span
				>
			</header>
			<p v-if="connection.loading.value" class="tools-mcp-loading">Testing connection and loading tools...</p>
			<UiAlert v-if="connection.error.value" title="Connection Failed" type="error" show-icon
				>{{ connection.error.value }}
				<details v-if="connection.stack.value">
					<summary>Stack Trace</summary>
					<pre>{{ connection.stack.value }}</pre>
				</details>
				<template #action
					><UiButton size="small" @click="connection.fetch"
						><template #icon><UiIcon name="ReloadOutlined" /></template>Retry</UiButton
					></template
				></UiAlert
			>
			<div v-else-if="!connection.loading.value && !connection.tools.value.length" class="tools-mcp-dashed-empty">
				<UiIcon name="CheckCircleOutlined" :size="24" />
				<p>Connection successful!</p>
				<small>No tools found for this MCP server</small>
			</div></template
		></UiCard
	>
</template>
