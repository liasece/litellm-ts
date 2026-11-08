<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AccessFieldComponent from "../../access-control/ui/AccessFieldComponent.vue";
import UiFormField from "../../platform/ui/UiFormField.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import KeyMcpPermissionsComponent from "../../virtual-keys/ui/KeyMcpPermissionsComponent.vue";
import { agentsApi } from "../api/AgentsApi";
import type { AgentEntitlements } from "../support/AgentModels";
const draft = defineModel<AgentEntitlements>({ required: true });
defineProps<{ models: string[]; agents: { agent_id: string; agent_name: string }[] }>();
const servers = ref<{ server_id: string; server_name?: string | null }[]>([]),
	groups = ref<string[]>([]);
const options = computed(() => [
		...groups.value.map((value) => ({ value, label: value, description: "Access Group" })),
		...servers.value.map((server) => ({
			value: server.server_id,
			label: `${server.server_name || server.server_id} (${server.server_id})`,
			description: "MCP Server",
		})),
	]),
	selected = computed({
		get: () => [...draft.value.mcp_servers, ...draft.value.mcp_access_groups],
		set: (value: (string | number)[] | string | number | null | undefined) => {
			const values = Array.isArray(value) ? value.map(String) : [];
			draft.value.mcp_servers = values.filter((id) => !groups.value.includes(id));
			draft.value.mcp_access_groups = values.filter((id) => groups.value.includes(id));
		},
	});
const permission = computed({
	get: () => ({ mcp_servers: draft.value.mcp_servers, mcp_tool_permissions: draft.value.mcp_tool_permissions }),
	set: (value) => {
		draft.value.mcp_tool_permissions = value.mcp_tool_permissions;
	},
});
onMounted(() => {
	void agentsApi.mcpServers().then((value) => {
		servers.value = value;
	});
	void agentsApi.mcpGroups().then((value) => {
		groups.value = value;
	});
});
</script>
<template>
	<section class="tools-agent-entitlements">
		<p>
			Configure which models, agents, and MCP tools this agent is allowed to use. Leave fields empty to allow all (subject to key/team
			permissions).
		</p>
		<AccessFieldComponent
			v-model="draft.models"
			label="Allowed Models"
			name="agent-entitlement-models"
			type="select"
			multiple
			creatable
			:options="models.map((value) => ({ value, label: value }))"
			tooltip="Restrict which models this agent can call. Leave empty to allow all."
			placeholder="Select models (leave empty for all)"
		/><AccessFieldComponent
			v-model="draft.agents"
			label="Allowed Agents (Sub-Agents)"
			name="agent-entitlement-agents"
			type="select"
			multiple
			:options="agents.map((agent) => ({ value: agent.agent_id, label: agent.agent_name }))"
			tooltip="Restrict which other agents this agent can invoke as sub-agents. Leave empty to allow all."
			placeholder="Select agents (leave empty for all)"
		/>
		<hr />
		<UiFormField
			><template #label
				>Allowed MCP Servers<UiTooltip :title="'Select which MCP servers or access groups this agent can access'"
					><UiIcon name="InfoCircleOutlined" class="access-field-tooltip" /></UiTooltip></template
			><UiSelect
				v-model="selected"
				:options="options"
				multiple
				searchable
				clearable
				placeholder="Select MCP servers or access groups (optional)" /></UiFormField
		><KeyMcpPermissionsComponent
			v-model="permission"
			:catalog="{ mcpServers: servers.map((server) => ({ value: server.server_id, label: server.server_name || server.server_id })) }"
		/>
	</section>
</template>
