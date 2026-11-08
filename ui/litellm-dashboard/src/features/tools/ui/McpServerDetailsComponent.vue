<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import McpCostDisplayComponent from "./McpCostDisplayComponent.vue";
import McpServerSettingsComponent from "./McpServerSettingsComponent.vue";
import McpToolsViewerComponent from "./McpToolsViewerComponent.vue";
import { copyToolText } from "../support/ToolClipboardSupport";
import { maskedMcpUrl } from "../logic/McpDraftLogic";
import { handleTransport, handleAuth, type MCPServer } from "../support/McpModels";
import "../styles/McpDetailsStyles.css";
const props = defineProps<{ server: MCPServer; admin: boolean }>();
const emit = defineEmits<{ edit: [] }>();
const tab = ref("overview"),
	show = ref(false),
	copied = ref<Record<string, boolean>>({}),
	timers = new Set<ReturnType<typeof setTimeout>>();
const name = computed(() => props.server.server_name || props.server.alias || "Unnamed Server"),
	items = computed(() => [
		{ key: "overview", label: "Overview" },
		{ key: "tools", label: "MCP Tools" },
		...(props.admin ? [{ key: "settings", label: "Settings" }] : []),
	]);
async function copy(value: string | null | undefined, key: string) {
	if (await copyToolText(value || "")) {
		copied.value[key] = true;
		const timer = setTimeout(() => {
			copied.value[key] = false;
			timers.delete(timer);
		}, 2000);
		timers.add(timer);
	}
}
onBeforeUnmount(() => {
	for (const timer of timers) clearTimeout(timer);
});
</script>
<template>
	<div class="tools-mcp-details">
		<header>
			<div>
				<h2>{{ name }}</h2>
				<UiButton
					variant="text"
					size="small"
					aria-label="Copy server name"
					:class="{ copied: copied.name }"
					@click="copy(server.server_name || server.alias, 'name')"
					><UiLucideIcon :name="copied.name ? 'Check' : 'Copy'" :size="12" /></UiButton
				><span v-if="server.alias && server.server_name && server.alias !== server.server_name" class="tools-mcp-alias">{{
					server.alias
				}}</span>
			</div>
			<p>
				<span>{{ server.server_id }}</span
				><UiButton
					variant="text"
					size="small"
					aria-label="Copy server ID"
					:class="{ copied: copied.id }"
					@click="copy(server.server_id, 'id')"
					><UiLucideIcon :name="copied.id ? 'Check' : 'Copy'" :size="10"
				/></UiButton>
			</p>
			<small v-if="server.description">{{ server.description }}</small>
		</header>
		<UiTabs v-model="tab" :items="items" appearance="tremor" />
		<div v-if="tab === 'overview'" class="tools-mcp-overview">
			<div class="tools-mcp-overview-grid">
				<UiCard :padding="16"
					><label>Transport</label>
					<div>
						<span class="tools-mcp-detail-badge">{{ handleTransport(server.transport, server.spec_path).toUpperCase() }}</span>
					</div></UiCard
				><UiCard :padding="16"
					><label>Authentication</label>
					<div>
						<span class="tools-mcp-detail-badge">{{ handleAuth(server.auth_type) }}</span>
					</div></UiCard
				><UiCard :padding="16"
					><label>Host URL</label>
					<div class="tools-mcp-host">
						<span>{{ show ? server.url : maskedMcpUrl(server.url || "") || "—" }}</span
						><button
							v-if="server.url && maskedMcpUrl(server.url) !== server.url"
							type="button"
							aria-label="Toggle full URL"
							@click="show = !show"
						>
							<UiLucideIcon :name="show ? 'EyeOff' : 'Eye'" :size="20" />
						</button></div
				></UiCard>
			</div>
			<UiCard :padding="16" class="tools-mcp-overview-cost"
				><label>Cost Configuration</label>
				<div><McpCostDisplayComponent :cost="server.mcp_info?.mcp_server_cost_info" /></div
			></UiCard>
		</div>
		<McpToolsViewerComponent v-else-if="tab === 'tools'" :server="server" /><McpServerSettingsComponent
			v-else
			v-model:show="show"
			:server="server"
			@edit="emit('edit')"
		/>
	</div>
</template>
