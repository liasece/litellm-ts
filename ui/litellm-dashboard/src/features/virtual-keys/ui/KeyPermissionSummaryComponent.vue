<script setup lang="ts">
import KeyHeroIcon from "./KeyHeroIconComponent.vue";
import "./styles/KeyPermissionSummary.css";
import { computed, reactive } from "vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { recordValue, stringValues, type KeyCatalog, type VirtualKey } from "../support/VirtualKeyModels";
import KeyBadge from "./KeyBadgeComponent.vue";
const props = defineProps<{
	keyData: Pick<VirtualKey, "object_permission">;
	catalog: Pick<KeyCatalog, "vectorStores" | "mcpServers" | "agents">;
}>();
const permission = computed(() => recordValue(props.keyData.object_permission));
const expanded = reactive(new Set<string>());
const vector = computed(() => stringValues(permission.value.vector_stores));
const servers = computed(() => [
	...stringValues(permission.value.mcp_servers).map((value) => ({ value, group: false })),
	...stringValues(permission.value.mcp_access_groups).map((value) => ({ value, group: true })),
]);
const agents = computed(() => [
	...stringValues(permission.value.agents).map((value) => ({ value, group: false })),
	...stringValues(permission.value.agent_access_groups).map((value) => ({ value, group: true })),
]);
function tools(id: string) {
	return stringValues(recordValue(permission.value.mcp_tool_permissions)[id]);
}
function toggle(id: string) {
	if (!tools(id).length) return;
	if (expanded.has(id)) expanded.delete(id);
	else expanded.add(id);
}
function shortId(id: string) {
	return id.length > 7 ? id.slice(0, 3) + "..." + id.slice(-4) : id;
}
function serverName(id: string) {
	const name = props.catalog.mcpServers.find((server) => server.value === id)?.label;
	return name ? name + " (" + shortId(id) + ")" : id;
}
function agentName(id: string) {
	const name = props.catalog.agents.find((agent) => agent.value === id)?.label;
	return name ? name + " (" + shortId(id) + ")" : id;
}
</script>
<template>
	<div class="vk-permission-summary">
		<h3>Object Permissions</h3>
		<section>
			<h4>
				<KeyHeroIcon name="DatabaseIcon" />Vector Stores<KeyBadge small>{{ vector.length }}</KeyBadge>
			</h4>
			<div v-if="vector.length" class="vk-summary-badges">
				<span v-for="id in vector" :key="id" class="vk-permission-label">{{
					catalog.vectorStores.find((store) => store.value === id)?.label
						? catalog.vectorStores.find((store) => store.value === id)?.label
						: id
				}}</span>
			</div>
			<div v-else class="vk-summary-empty"><KeyHeroIcon name="DatabaseIcon" />No vector stores configured</div>
		</section>
		<section>
			<h4>
				<KeyHeroIcon name="ServerIcon" />MCP Servers<KeyBadge small>{{ servers.length }}</KeyBadge>
			</h4>
			<div v-if="servers.length" class="vk-permission-items">
				<div v-for="server in servers" :key="server.value">
					<button
						type="button"
						class="vk-permission-item"
						:class="{ 'vk-permission-item--expandable': tools(server.value).length && !server.group }"
						:aria-expanded="tools(server.value).length ? expanded.has(server.value) : undefined"
						@click="!server.group && toggle(server.value)"
					>
						<UiTooltip :title="'Full ID: ' + server.value"
							><span
								><i :class="{ 'vk-dot--green': server.group }" />{{ server.group ? server.value : serverName(server.value)
								}}<small v-if="server.group" class="vk-group-badge">Group</small></span
							></UiTooltip
						><small v-if="!server.group && tools(server.value).length"
							>{{ tools(server.value).length }} {{ tools(server.value).length === 1 ? "tool" : "tools"
							}}<UiIcon :name="expanded.has(server.value) ? 'DownOutlined' : 'RightOutlined'"
						/></small>
					</button>
					<div v-if="!server.group && expanded.has(server.value) && tools(server.value).length" class="vk-summary-tools">
						<span v-for="tool in tools(server.value)" :key="tool" class="vk-permission-label">{{ tool }}</span>
					</div>
				</div>
			</div>
			<div v-else class="vk-summary-empty"><KeyHeroIcon name="ServerIcon" />No MCP servers or access groups configured</div>
		</section>
		<section>
			<h4>
				<KeyHeroIcon name="UserGroupIcon" />Agents<KeyBadge color="purple" small>{{ agents.length }}</KeyBadge>
			</h4>
			<div v-if="agents.length" class="vk-permission-items">
				<div v-for="agent in agents" :key="agent.value" class="vk-permission-item">
					<UiTooltip :title="'Full ID: ' + agent.value"
						><span
							><i class="vk-dot--purple" :class="{ 'vk-dot--green': agent.group }" />{{
								agent.group ? agent.value : agentName(agent.value)
							}}<small v-if="agent.group" class="vk-group-badge">Group</small></span
						></UiTooltip
					>
				</div>
			</div>
			<div v-else class="vk-summary-empty"><KeyHeroIcon name="UserGroupIcon" />No agents or access groups configured</div>
		</section>
	</div>
</template>
