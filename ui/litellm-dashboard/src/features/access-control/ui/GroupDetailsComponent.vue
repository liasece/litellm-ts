<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiEmptyState from "../../platform/ui/UiEmptyState.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import type { AccessGroup } from "../support/AccessModels";
const props = defineProps<{ group: AccessGroup }>();
const emit = defineEmits<{ back: []; edit: [] }>();
const showAllKeys = ref(false),
	showAllTeams = ref(false),
	tab = ref("models");
const resourceIds = computed(() =>
	tab.value === "models"
		? props.group.access_model_names
		: tab.value === "mcp"
			? props.group.access_mcp_server_ids
			: props.group.access_agent_ids,
);
const empty = computed(() =>
	tab.value === "models"
		? "No models assigned to this group"
		: tab.value === "mcp"
			? "No MCP servers assigned to this group"
			: "No agents assigned to this group",
);
watch(
	() => props.group.access_group_id,
	() => {
		showAllKeys.value = false;
		showAllTeams.value = false;
		tab.value = "models";
	},
);
async function copy() {
	await navigator.clipboard.writeText(props.group.access_group_id);
}
</script>
<template>
	<div class="access-detail-header">
		<div class="access-heading">
			<UiButton variant="text" class="access-group-back" aria-label="Back" @click="emit('back')"
				><UiLucideIcon name="ArrowLeft" :size="16"
			/></UiButton>
			<div>
				<h2>{{ group.access_group_name }}</h2>
				<p class="access-group-id">
					<span class="access-muted">ID:&nbsp;</span
					><button type="button" class="access-copy-text access-group-id-value" @click="copy">
						{{ group.access_group_id }}<UiIcon name="CopyOutlined" :size="14" />
					</button>
				</p>
			</div>
		</div>
		<UiButton variant="primary" @click="emit('edit')"><UiLucideIcon name="Edit" :size="16" />Edit Access Group</UiButton>
	</div>
	<UiCard appearance="antd" class="access-metadata-card"
		><h5>Group Details</h5>
		<dl class="access-descriptions">
			<div class="access-description-row">
				<dt>Description</dt>
				<dd>{{ group.description || "—" }}</dd>
			</div>
			<div class="access-description-row">
				<dt>Created</dt>
				<dd>
					{{ new Date(group.created_at).toLocaleString()
					}}<span v-if="group.created_by">
						by {{ group.created_by === "default_user_id" ? "Default Proxy Admin" : group.created_by }}</span
					>
				</dd>
			</div>
			<div class="access-description-row">
				<dt>Last Updated</dt>
				<dd>
					{{ new Date(group.updated_at).toLocaleString()
					}}<span v-if="group.updated_by">
						by {{ group.updated_by === "default_user_id" ? "Default Proxy Admin" : group.updated_by }}</span
					>
				</dd>
			</div>
		</dl></UiCard
	>
	<div class="access-columns access-attached-columns">
		<UiCard appearance="antd"
			><template #title
				><UiLucideIcon name="KeyIcon" :size="16" />Attached Keys <UiTag>{{ group.assigned_key_ids.length }}</UiTag></template
			><template #extra
				><UiButton v-if="group.assigned_key_ids.length > 5" variant="link" @click="showAllKeys = !showAllKeys">{{
					showAllKeys ? "Show Less" : `View All (${group.assigned_key_ids.length})`
				}}</UiButton></template
			>
			<div v-if="group.assigned_key_ids.length" class="access-tags">
				<UiTag v-for="id in group.assigned_key_ids.slice(0, showAllKeys ? undefined : 5)" :key="id"
					><code>{{ id.length > 20 ? id.slice(0, 10) + "..." + id.slice(-6) : id }}</code></UiTag
				>
			</div>
			<UiEmptyState v-else description="No keys attached" /></UiCard
		><UiCard appearance="antd"
			><template #title
				><UiLucideIcon name="Users" :size="16" />Attached Teams <UiTag>{{ group.assigned_team_ids.length }}</UiTag></template
			><template #extra
				><UiButton v-if="group.assigned_team_ids.length > 5" variant="link" @click="showAllTeams = !showAllTeams">{{
					showAllTeams ? "Show Less" : `View All (${group.assigned_team_ids.length})`
				}}</UiButton></template
			>
			<div v-if="group.assigned_team_ids.length" class="access-tags">
				<UiTag v-for="id in group.assigned_team_ids.slice(0, showAllTeams ? undefined : 5)" :key="id"
					><code>{{ id }}</code></UiTag
				>
			</div>
			<UiEmptyState v-else description="No teams attached"
		/></UiCard>
	</div>
	<UiCard appearance="antd" class="access-resource-tabs-card"
		><UiTabs
			v-model="tab"
			class="access-resource-tabs"
			:items="[
				{ key: 'models', label: 'Models', count: group.access_model_names.length },
				{ key: 'mcp', label: 'MCP Servers', count: group.access_mcp_server_ids.length },
				{ key: 'agents', label: 'Agents', count: group.access_agent_ids.length },
			]"
			><template #tab-models="{ item }"
				><UiLucideIcon name="LayersIcon" :size="16" />{{ item.label }}<span class="ui-tabs__count">{{ item.count }}</span></template
			><template #tab-mcp="{ item }"
				><UiLucideIcon name="ServerIcon" :size="16" />{{ item.label }}<span class="ui-tabs__count">{{ item.count }}</span></template
			><template #tab-agents="{ item }"
				><UiLucideIcon name="Bot" :size="16" />{{ item.label }}<span class="ui-tabs__count">{{ item.count }}</span></template
			></UiTabs
		>
		<div v-if="resourceIds.length" class="access-resource-grid">
			<UiCard v-for="id in resourceIds" :key="id" appearance="antd" size="small"
				><code>{{ id }}</code></UiCard
			>
		</div>
		<UiEmptyState v-else :description="empty"
	/></UiCard>
</template>
