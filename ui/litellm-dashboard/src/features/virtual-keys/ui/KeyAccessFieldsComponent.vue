<script setup lang="ts">
import { useKeyFieldIdentity } from "../support/KeyFormIdentity";
import { computed } from "vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import { stringValues, type KeyCatalog, type KeyDraft } from "../support/VirtualKeyModels";
import KeyField from "./KeyFieldComponent.vue";
import KeyMcpPermissions from "./KeyMcpPermissionsComponent.vue";
const draft = defineModel<KeyDraft>({ required: true });
defineProps<{ catalog: KeyCatalog; horizontal?: boolean; disabled?: boolean; section?: "mcp" | "agents" | "all" }>();
const mcpSelection = computed(() => [...draft.value.mcp_access_groups.map((value) => "group:" + value), ...draft.value.mcp_servers]);
const agentSelection = computed(() => [...draft.value.agent_access_groups.map((value) => "group:" + value), ...draft.value.allowed_agents]);
function mcp(value: unknown) {
	const values = stringValues(value);
	draft.value.mcp_servers = values.filter((value) => !value.startsWith("group:"));
	draft.value.mcp_access_groups = values.filter((value) => value.startsWith("group:")).map((value) => value.slice(6));
}
function agents(value: unknown) {
	const values = stringValues(value);
	draft.value.allowed_agents = values.filter((value) => !value.startsWith("group:"));
	draft.value.agent_access_groups = values.filter((value) => value.startsWith("group:")).map((value) => value.slice(6));
}
const fieldId = useKeyFieldIdentity();
</script>
<template>
	<KeyField
		v-if="section !== 'agents'"
		:label="horizontal ? 'Allowed MCP Servers' : 'MCP Servers / Access Groups'"
		name="mcp_servers"
		:horizontal="horizontal"
		:help="horizontal ? 'Select MCP servers or access groups this key can access' : undefined"
		><UiSelect
			:id="fieldId('mcp_servers')"
			:model-value="mcpSelection"
			:options="[
				...catalog.mcpGroups.map((group) => ({ value: 'group:' + group.value, label: group.label, description: 'Access Group' })),
				...catalog.mcpServers,
			]"
			:disabled="disabled"
			multiple
			searchable
			clearable
			placeholder="Select MCP servers or access groups (optional)"
			@update:model-value="mcp"
	/></KeyField>
	<div v-if="section !== 'agents' && draft.mcp_servers.length" class="vk-mcp-tools">
		<KeyMcpPermissions v-model="draft" :catalog="catalog" :disabled="disabled" />
	</div>
	<KeyField
		v-if="section !== 'mcp'"
		:label="horizontal ? 'Allowed Agents' : 'Agents / Access Groups'"
		name="allowed_agents"
		:horizontal="horizontal"
		:help="horizontal ? 'Select agents or access groups this key can access' : undefined"
		><UiSelect
			:id="fieldId('allowed_agents')"
			:model-value="agentSelection"
			:options="[
				...catalog.agentGroups.map((group) => ({ value: 'group:' + group.value, label: group.label, description: 'Access Group' })),
				...catalog.agents,
			]"
			:disabled="disabled"
			multiple
			searchable
			clearable
			placeholder="Select agents or access groups (optional)"
			@update:model-value="agents"
	/></KeyField>
</template>
