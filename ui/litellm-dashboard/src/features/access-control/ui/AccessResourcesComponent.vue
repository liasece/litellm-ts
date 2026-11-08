<script setup lang="ts">
import { computed } from "vue";
import AccessFieldComponent from "./AccessFieldComponent.vue";
import KeyMcpPermissionsComponent from "../../virtual-keys/ui/KeyMcpPermissionsComponent.vue";
import { objectValue, stringList } from "../logic/ResourceDraftLogic";
import type { AccessCatalog, AccessRecord } from "../support/AccessModels";
const draft = defineModel<AccessRecord>({ required: true });
const props = defineProps<{ catalog: AccessCatalog; organization?: boolean; editing?: boolean; disabled?: boolean }>();
const mcp = computed({
	get: () => ({
		mcp_servers: stringList(draft.value.mcp_servers),
		mcp_tool_permissions: objectValue(draft.value.mcp_tool_permissions) as Record<string, string[]>,
	}),
	set: (value) => {
		draft.value.mcp_servers = value.mcp_servers;
		draft.value.mcp_tool_permissions = value.mcp_tool_permissions;
	},
});
const mcpSelection = computed(() => [
	...stringList(draft.value.mcp_access_groups).map((value) => "group:" + value),
	...stringList(draft.value.mcp_servers),
]);
const agentSelection = computed(() => [
	...stringList(draft.value.agent_access_groups).map((value) => "group:" + value),
	...stringList(draft.value.agents),
]);
function selection(value: unknown, kind: "mcp" | "agent") {
	const list = stringList(value);
	draft.value[kind === "mcp" ? "mcp_servers" : "agents"] = list.filter((value) => !value.startsWith("group:"));
	draft.value[kind === "mcp" ? "mcp_access_groups" : "agent_access_groups"] = list
		.filter((value) => value.startsWith("group:"))
		.map((value) => value.slice(6));
}
const mcpCatalog = computed(() => ({ mcpServers: props.catalog.mcpServers }));
</script>
<template>
	<div>
		<AccessFieldComponent
			v-model="draft.vector_stores"
			name="resource-vector-stores"
			:label="organization && !editing ? 'Allowed Vector Stores' : 'Vector Stores'"
			type="select"
			multiple
			:options="catalog.vectorStores"
			:disabled="disabled"
			:placeholder="organization && !editing ? 'Select vector stores (optional)' : 'Select vector stores'"
			:tooltip="
				organization && !editing
					? 'Select which vector stores this organization can access by default. Leave empty for access to all vector stores'
					: undefined
			"
			tooltip-icon="InfoCircleOutlined"
			:help="
				organization && !editing
					? 'Select vector stores this organization can access. Leave empty for access to all vector stores'
					: undefined
			"
			:horizontal="!editing"
		/><AccessFieldComponent
			v-if="!organization && editing"
			v-model="draft.allowed_passthrough_routes"
			name="resource-pass-through"
			label="Allowed Pass Through Routes"
			type="select"
			multiple
			:options="catalog.passthroughRoutes"
			:disabled="disabled"
			placeholder="Select pass through routes"
		/><AccessFieldComponent
			:model-value="mcpSelection"
			@update:model-value="selection($event, 'mcp')"
			name="resource-mcp"
			:label="organization ? 'Allowed MCP Servers' : 'MCP Servers / Access Groups'"
			type="select"
			multiple
			:options="[
				...catalog.mcpGroups.map((group) => ({ ...group, value: 'group:' + group.value, description: 'Access Group' })),
				...catalog.mcpServers,
			]"
			:disabled="disabled"
			:placeholder="
				organization && !editing
					? 'Select MCP servers and access groups (optional)'
					: 'Select MCP servers or access groups (optional)'
			"
			:tooltip="
				organization && !editing ? 'Select which MCP servers and access groups this organization can access by default.' : undefined
			"
			tooltip-icon="InfoCircleOutlined"
			:help="organization && !editing ? 'Select MCP servers and access groups this organization can access.' : undefined"
			:horizontal="!editing"
		/><KeyMcpPermissionsComponent v-if="!organization" v-model="mcp" :catalog="mcpCatalog" :disabled="disabled" /><template
			v-if="!organization"
			><AccessFieldComponent
				:model-value="agentSelection"
				@update:model-value="selection($event, 'agent')"
				name="resource-agents"
				label="Agents / Access Groups"
				type="select"
				multiple
				:options="[
					...catalog.agentGroups.map((group) => ({ ...group, value: 'group:' + group.value, description: 'Access Group' })),
					...catalog.agents,
				]"
				:disabled="disabled"
				placeholder="Select agents or access groups (optional)"
				:horizontal="!editing"
		/></template>
	</div>
</template>
