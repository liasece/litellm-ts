<script setup lang="ts">
import { ref } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import type { MCPServer } from "../support/McpModels";
const props = defineProps<{ server: MCPServer; action: "approve" | "reject"; pending: boolean }>();
const emit = defineEmits<{ cancel: []; confirm: [notes?: string] }>();
const notes = ref("");
</script>
<template>
	<UiDialog
		scroll-mode="overlay"
		:open="true"
		:title="action === 'approve' ? 'Approve MCP Server' : 'Reject MCP Server'"
		:show-footer="false"
		:closable="false"
		:mask-closable="false"
		:width="384"
		centered
		class="tools-mcp-review-confirm"
		data-mcp-review-confirm
		@cancel="emit('cancel')"
		><div :class="['tools-mcp-confirm-icon', action]">
			<UiLucideIcon :name="action === 'approve' ? 'Check' : 'AlertCircle'" :size="20" />
		</div>
		<h3>{{ action === "approve" ? "Approve MCP Server" : "Reject MCP Server" }}</h3>
		<p>
			Are you sure you want to {{ action }}
			<strong>&quot;{{ props.server.alias ?? props.server.server_name ?? props.server.server_id }}&quot;</strong>?
			{{
				action === "approve"
					? "This will make it active and available for use."
					: server.approval_status === "active"
						? "This server is currently live. Rejecting it will immediately remove it from the proxy runtime."
						: "This will mark the submission as rejected."
			}}
		</p>
		<textarea v-if="action === 'reject'" v-model="notes" rows="3" placeholder="Reason for rejection (optional)" />
		<footer>
			<button type="button" @click="emit('cancel')">Cancel</button
			><button
				type="button"
				:class="action"
				:disabled="pending"
				@click="emit('confirm', action === 'approve' ? undefined : notes || undefined)"
			>
				{{ action === "approve" ? "Approve" : "Reject" }}
			</button>
		</footer></UiDialog
	>
</template>
