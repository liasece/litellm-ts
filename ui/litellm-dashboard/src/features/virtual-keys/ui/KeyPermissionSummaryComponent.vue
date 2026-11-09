<script setup lang="ts">
import KeyHeroIcon from "./KeyHeroIconComponent.vue";
import "./styles/KeyPermissionSummary.css";
import { computed } from "vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { recordValue, stringValues, type VirtualKey } from "../support/VirtualKeyModels";
import KeyBadge from "./KeyBadgeComponent.vue";
const props = defineProps<{ keyData: Pick<VirtualKey, "object_permission"> }>();
const permission = computed(() => recordValue(props.keyData.object_permission));
const vector = computed(() => stringValues(permission.value.vector_stores));
const agents = computed(() => [
	...stringValues(permission.value.agents).map((value) => ({ value, group: false })),
	...stringValues(permission.value.agent_access_groups).map((value) => ({ value, group: true })),
]);
function shortId(id: string) {
	return id.length > 7 ? id.slice(0, 3) + "..." + id.slice(-4) : id;
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
				<span v-for="id in vector" :key="id" class="vk-permission-label">{{ shortId(id) }}</span>
			</div>
			<div v-else class="vk-summary-empty"><KeyHeroIcon name="DatabaseIcon" />No vector stores configured</div>
		</section>
		<section>
			<h4>
				<KeyHeroIcon name="UserGroupIcon" />Agents<KeyBadge color="purple" small>{{ agents.length }}</KeyBadge>
			</h4>
			<div v-if="agents.length" class="vk-permission-items">
				<div v-for="agent in agents" :key="agent.value" class="vk-permission-item">
					<UiTooltip :title="'Full ID: ' + agent.value"
						><span
							><i class="vk-dot--purple" :class="{ 'vk-dot--green': agent.group }" />{{ shortId(agent.value)
							}}<small v-if="agent.group" class="vk-group-badge">Group</small></span
						></UiTooltip
					>
				</div>
			</div>
			<div v-else class="vk-summary-empty"><KeyHeroIcon name="UserGroupIcon" />No agents or access groups configured</div>
		</section>
	</div>
</template>
