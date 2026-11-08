<script setup lang="ts">
import { computed } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import McpCostDisplayComponent from "./McpCostDisplayComponent.vue";
import { handleTransport, handleAuth, type MCPServer } from "../support/McpModels";
import { maskedMcpUrl } from "../logic/McpDraftLogic";
const props = defineProps<{ server: MCPServer }>();
const emit = defineEmits<{ edit: [] }>();
const show = defineModel<boolean>("show", { default: false });
const rows = computed(() => [
	{ key: "server_name", label: "Server Name", value: props.server.server_name },
	{ key: "alias", label: "Alias", value: props.server.alias },
	{ key: "description", label: "Description", value: props.server.description },
	{ key: "url", label: "URL", value: props.server.url },
	{ key: "transport", label: "Transport", value: handleTransport(props.server.transport, props.server.spec_path) },
	{ key: "auth_type", label: "Authentication", value: handleAuth(props.server.auth_type) },
	{ key: "extra_headers", label: "Extra Headers", value: props.server.extra_headers?.join(", ") },
	{ key: "allow_all_keys", label: "Allow All Keys" },
	{ key: "network", label: "Network Access" },
	{ key: "groups", label: "Access Groups" },
	{ key: "tools", label: "Allowed Tools" },
	{ key: "cost", label: "Cost" },
]);
</script>
<template>
	<UiCard class="tools-mcp-settings-card"
		><header>
			<h3>MCP Server Settings</h3>
			<UiButton appearance="tremor" variant="text" @click="emit('edit')">Edit Settings</UiButton>
		</header>
		<div v-for="row in rows" :key="row.key" class="tools-mcp-settings-row">
			<label>{{ row.label }}</label>
			<div>
				<template v-if="row.key === 'url'"
					><span class="tools-mcp-url">{{ show ? server.url : maskedMcpUrl(server.url || "") || "—" }}</span
					><button
						v-if="server.url && maskedMcpUrl(server.url) !== server.url"
						type="button"
						aria-label="Toggle full URL"
						@click="show = !show"
					>
						<UiLucideIcon :name="show ? 'EyeOff' : 'Eye'" :size="20" /></button></template
				><span v-else-if="row.key === 'transport' || row.key === 'auth_type'" class="tools-mcp-detail-badge">{{
					row.key === "transport" ? String(row.value).toUpperCase() : row.value
				}}</span
				><span
					v-else-if="row.key === 'allow_all_keys'"
					:class="['tools-mcp-status-badge', { 'tools-mcp-status-badge--green': server.allow_all_keys }]"
					><i v-if="server.allow_all_keys" />{{ server.allow_all_keys ? "Enabled" : "Disabled" }}</span
				><span
					v-else-if="row.key === 'network'"
					:class="[
						'tools-mcp-status-badge',
						server.available_on_public_internet ? 'tools-mcp-status-badge--green' : 'tools-mcp-status-badge--orange',
					]"
					><i />{{ server.available_on_public_internet ? "Public" : "Internal only" }}</span
				><template v-else-if="row.key === 'groups'"
					><div v-if="server.mcp_access_groups?.length" class="tools-mcp-badges">
						<span v-for="group in server.mcp_access_groups" :key="group" class="tools-mcp-small-badge">{{ group }}</span>
					</div>
					<span v-else class="tools-mcp-muted">—</span></template
				><template v-else-if="row.key === 'tools'"
					><div v-if="server.allowed_tools?.length" class="tools-mcp-badges">
						<span v-for="tool in server.allowed_tools" :key="tool" class="tools-mcp-small-badge tools-mcp-small-badge--blue">{{
							tool
						}}</span>
					</div>
					<span v-else class="tools-mcp-small-badge tools-mcp-small-badge--green">All tools enabled</span></template
				><McpCostDisplayComponent v-else-if="row.key === 'cost'" :cost="server.mcp_info?.mcp_server_cost_info" /><span
					v-else
					:class="{ 'tools-mcp-muted': !row.value, 'tools-mcp-url': row.key === 'alias' }"
					>{{ row.value || "—" }}</span
				>
			</div>
		</div></UiCard
	>
</template>
