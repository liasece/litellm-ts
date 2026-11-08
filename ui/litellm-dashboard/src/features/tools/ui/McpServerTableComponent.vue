<script setup lang="ts">
import UiTable from "../../platform/ui/UiTable.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import McpHealthBadgeComponent from "./McpHealthBadgeComponent.vue";
import { maskedMcpUrl } from "../logic/McpDraftLogic";
import type { MCPServer } from "../support/McpModels";
defineProps<{ rows: MCPServer[]; loading: boolean; healthLoading: boolean; rechecking: Set<string> }>();
const emit = defineEmits<{
	select: [server: MCPServer];
	edit: [server: MCPServer];
	delete: [server: MCPServer];
	connect: [server: MCPServer];
	recheck: [id: string];
}>();
const columns = [
	{ key: "server_id", width: 150, label: "Server ID", sortable: true },
	{ key: "server_name", width: 150, label: "Name", sortable: true },
	{ key: "alias", width: 150, label: "Alias", sortable: true },
	{ key: "url", width: 150, label: "URL" },
	{ key: "transport", width: 150, label: "Transport", sortable: true },
	{ key: "auth_type", width: 150, label: "Auth Type", sortable: true },
	{ key: "health_status", width: 150, label: "Health Status" },
	{ key: "mcp_access_groups", width: 150, label: "Access Groups" },
	{ key: "available_on_public_internet", width: 150, label: "Network Access" },
	{ key: "created_at", width: 150, label: "Created", sortable: true },
	{ key: "updated_at", width: 150, label: "Updated", sortable: true },
	{ key: "credential", width: 150, label: "Credential" },
	{ key: "actions", width: 150, label: "Actions" },
];
function server(row: Record<string, unknown>) {
	return row as MCPServer;
}
function hide(event: Event) {
	(event.target as HTMLImageElement).style.display = "none";
}
</script>
<template>
	<UiTable :columns="columns" :rows="rows" row-key="server_id" appearance="tremor" :loading="loading" class="tools-mcp-table"
		><template #empty>{{
			loading ? "Loading MCP servers..." : "No MCP servers configured. Click '+ Add New MCP Server' to get started."
		}}</template
		><template #cell-server_id="{ row }"
			><button type="button" class="tools-mcp-id" @click="emit('select', server(row))">
				{{ server(row).server_id.slice(0, 7) }}...
			</button></template
		><template #cell-server_name="{ row }"
			><div class="tools-mcp-server-name">
				<img
					v-if="server(row).mcp_info?.logo_url"
					:src="server(row).mcp_info?.logo_url"
					:alt="(server(row).server_name ?? 'MCP') + ' logo'"
					@error="hide"
				/><span>{{ row.server_name }}</span>
			</div></template
		><template #cell-url="{ row }"
			><span v-if="row.url" class="tools-mcp-table-url">{{ maskedMcpUrl(String(row.url)) }}</span
			><span v-else class="tools-mcp-muted">—</span></template
		><template #cell-transport="{ row }"
			><span class="tools-mcp-table-badge">{{
				(server(row).spec_path && row.transport !== "stdio" ? "OPENAPI" : String(row.transport || "http")).toUpperCase()
			}}</span></template
		><template #cell-auth_type="{ row }"
			><span class="tools-mcp-table-badge">{{ row.auth_type || "none" }}</span></template
		><template #cell-health_status="{ row }"
			><McpHealthBadgeComponent
				:server="server(row)"
				:loading="healthLoading || rechecking.has(String(row.server_id))"
				@recheck="emit('recheck', String(row.server_id))" /></template
		><template #cell-mcp_access_groups="{ row }"
			><UiTooltip v-if="server(row).mcp_access_groups?.length" :title="server(row).mcp_access_groups?.join(', ')"
				><div class="tools-mcp-group-cell">
					<span class="tools-mcp-small-badge">{{ server(row).mcp_access_groups?.[0] }}</span
					><small v-if="(server(row).mcp_access_groups?.length || 0) > 1"
						>+{{ (server(row).mcp_access_groups?.length || 0) - 1 }}</small
					>
				</div></UiTooltip
			><span v-else class="tools-mcp-muted">—</span></template
		><template #cell-available_on_public_internet="{ row }"
			><span
				:class="[
					'tools-mcp-status-badge',
					row.available_on_public_internet ? 'tools-mcp-status-badge--green' : 'tools-mcp-status-badge--orange',
				]"
				><i />{{ row.available_on_public_internet ? "Public" : "Internal" }}</span
			></template
		><template v-for="key in ['created_at', 'updated_at']" :key="key" #[`cell-${key}`]="{ row }"
			><UiTooltip v-if="row[key]" :title="new Date(String(row[key])).toLocaleString()"
				><span class="tools-mcp-table-date">{{ new Date(String(row[key])).toLocaleDateString() }}</span></UiTooltip
			><span v-else class="tools-mcp-muted">—</span></template
		><template #cell-credential="{ row }"
			><span v-if="!row.is_byok" class="tools-mcp-no-credential">—</span>
			<div v-else-if="row.has_user_credential" class="tools-mcp-credential">
				<span class="tools-mcp-status-badge tools-mcp-status-badge--green"><UiIcon name="CheckOutlined" :size="10" />Connected</span
				><button type="button" @click="emit('connect', server(row))">Update</button>
			</div>
			<button v-else type="button" class="tools-mcp-connect-button" @click="emit('connect', server(row))">Connect</button></template
		><template #cell-actions="{ row }"
			><div class="tools-mcp-row-actions">
				<UiTooltip title="Edit"
					><button type="button" aria-label="Edit MCP server" @click="emit('edit', server(row))">
						<span class="tools-mcp-row-action-icon"><UiHeroIcon name="PencilAltIcon" :size="20" /></span></button></UiTooltip
				><UiTooltip title="Delete"
					><button type="button" aria-label="Delete MCP server" @click="emit('delete', server(row))">
						<span class="tools-mcp-row-action-icon"><UiHeroIcon name="TrashIcon" :size="20" /></span></button
				></UiTooltip></div></template
	></UiTable>
</template>
