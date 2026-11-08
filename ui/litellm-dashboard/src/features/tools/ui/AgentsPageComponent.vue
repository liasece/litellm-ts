<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import AccessNoticeComponent from "../../access-control/ui/AccessNoticeComponent.vue";
import AccessActionComponent from "../../access-control/ui/AccessActionComponent.vue";
import AgentCreateDialogComponent from "./AgentCreateDialogComponent.vue";
import AgentDetailsComponent from "./AgentDetailsComponent.vue";
import { createResourceStore } from "../../platform/stores/ResourceStore";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { isAdminRole } from "../../identity/logic/UserRoleLogic";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { agentsApi } from "../api/AgentsApi";
import type { Agent, AgentKey } from "../support/AgentModels";
import "../../access-control/styles/AccessStyles.css";
import "../styles/ToolsStyles.css";
import "../styles/PluginStyles.css";
import "../styles/AgentStyles.css";
import "../styles/AgentWizardStyles.css";
const auth = useAuthenticationStore(),
	admin = computed(() => isAdminRole(auth.userRole.value)),
	health = ref(false),
	store = createResourceStore((signal) => agentsApi.list(health.value, signal)),
	{ state, ordered, rows } = store,
	keys = ref<AgentKey[]>([]),
	adding = ref(false),
	selected = ref(""),
	deleting = ref<Agent | null>(null),
	money = useMoneyFormatter();
state.sortBy = "created_at";
state.sortOrder = "desc";
const columns = computed(() => [
	{ key: "agent_name", label: "Agent Name" },
	{ key: "agent_id", label: "Agent ID" },
	{ key: "spend", label: "Spend" },
	{ key: "model", label: "Model" },
	{ key: "created_at", label: "Created" },
	{ key: "status", label: "Status" },
	...(admin.value ? [{ key: "actions", label: "Actions" }] : []),
]);
function agent(row: Record<string, unknown>) {
	return row as Agent;
}
async function remove() {
	if (!deleting.value) return;
	const item = deleting.value;
	try {
		if (await store.run(() => agentsApi.delete(item.agent_id), `Agent "${item.agent_name}" deleted successfully`))
			if (selected.value === item.agent_id) selected.value = "";
	} finally {
		deleting.value = null;
	}
}
watch(
	() => rows.value.length,
	async (count) => {
		if (count)
			try {
				keys.value = await agentsApi.keys(500);
			} catch {
				keys.value = [];
			}
		else keys.value = [];
	},
);
onMounted(() => void store.refresh());
onBeforeUnmount(store.dispose);
</script>
<template>
	<main class="tools-agents-page">
		<AccessNoticeComponent :error="state.error" :message="state.message" />
		<header>
			<h1>Agents</h1>
			<p>List of A2A-spec agents that are available to be used in your organization. Go to AI Hub, to make agents public.</p>
			<UiAlert title="Why do agents need keys?" type="info" show-icon
				>Keys scope access to an agent and allow it to call MCP tools. Assign a key when creating an agent or from the Virtual Keys
				page.</UiAlert
			>
			<div class="tools-agents-controls">
				<UiButton
					v-if="admin"
					appearance="tremor"
					variant="primary"
					:disabled="!auth.isAuthorized.value"
					@click="
						selected = '';
						adding = true;
					"
					>+ Add New Agent</UiButton
				><UiTooltip title="When enabled, only agents with reachable URLs are shown"
					><label
						><UiIcon name="CheckCircleOutlined" :size="14" :style="{ color: health ? '#22c55e' : '#9ca3af' }" />Health
						Check<UiSwitch
							v-model="health"
							size="small"
							:loading="state.loading && health"
							@update:model-value="store.refresh" /></label
				></UiTooltip>
			</div>
		</header>
		<UiCard
			><UiTable
				appearance="tremor"
				:columns="columns"
				:rows="ordered"
				row-key="agent_id"
				:loading="state.loading"
				row-clickable
				@row-click="selected = agent($event).agent_id"
				><template #cell-agent_id="{ row }"
					><UiTooltip :title="agent(row).agent_id"
						><button type="button" class="tools-resource-id" @click="selected = agent(row).agent_id">
							{{ agent(row).agent_id.slice(0, 7) }}...
						</button></UiTooltip
					></template
				><template #cell-spend="{ row }">{{ money(agent(row).spend, 4) }}</template
				><template #cell-model="{ row }"
					><UiTag appearance="tremor" size="xs" color="blue">{{ agent(row).litellm_params.model || "N/A" }}</UiTag></template
				><template #cell-created_at="{ value }">{{ value ? new Date(String(value)).toLocaleDateString() : "N/A" }}</template
				><template #cell-status="{ row }"
					><UiTag appearance="tremor" :color="keys.some((key) => key.agent_id === agent(row).agent_id) ? 'green' : 'yellow'">{{
						keys.some((key) => key.agent_id === agent(row).agent_id) ? "Active" : "Needs Setup"
					}}</UiTag></template
				><template #cell-actions="{ row }"
					><AccessActionComponent
						name="Trash2"
						label="Delete agent"
						appearance="tremor"
						@click="deleting = agent(row)" /></template
				><template #empty>No agents found. Click &quot;+ Add New Agent&quot; to create one.</template></UiTable
			></UiCard
		><AgentDetailsComponent
			v-if="selected"
			:key="selected"
			:id="selected"
			:admin="admin"
			@close="selected = ''"
			@changed="store.refresh"
			@delete="deleting = $event"
			@notice="state.message = $event"
			@error="state.error = $event"
		/><AgentCreateDialogComponent v-model:open="adding" @saved="store.refresh" /><UiDialog
			scroll-mode="overlay"
			:open="Boolean(deleting)"
			title="Delete Agent"
			ok-text="Delete"
			:confirm-loading="state.pending"
			@update:open="!$event && (deleting = null)"
			@ok="remove"
			><p>Are you sure you want to delete agent: {{ deleting?.agent_name }}?</p>
			<p>This action cannot be undone.</p>
			<template #footer
				><UiButton @click="deleting = null">Cancel</UiButton
				><UiButton variant="danger" :loading="state.pending" @click="remove">Delete</UiButton></template
			></UiDialog
		>
	</main>
</template>
