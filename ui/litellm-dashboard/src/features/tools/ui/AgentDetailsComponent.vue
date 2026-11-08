<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import UiDrawer from "../../platform/ui/UiDrawer.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import AccessFieldComponent from "../../access-control/ui/AccessFieldComponent.vue";
import AgentFieldsComponent from "./AgentFieldsComponent.vue";
import ToolDescriptionsComponent from "./ToolDescriptionsComponent.vue";
import { agentsApi } from "../api/AgentsApi";
import {
	baseAgentPayload,
	dynamicAgentPayload,
	detectAgentType,
	parseAgentDraft,
	rateLimitFields,
	agentCostFields,
} from "../logic/AgentDraftLogic";
import { agentEditErrors } from "../logic/AgentFormValidation";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import type { Agent, AgentTypeInfo } from "../support/AgentModels";
const props = defineProps<{ id: string; admin: boolean }>();
const emit = defineEmits<{ close: []; changed: []; delete: [agent: Agent]; notice: [message: string]; error: [message: string] }>();
const record = ref<Agent | null>(null),
	loading = ref(true),
	error = ref(""),
	editing = ref(false),
	pending = ref(false),
	draft = ref<Record<string, unknown>>({}),
	errors = ref<Record<string, string>>({}),
	metadata = ref<AgentTypeInfo[]>([]),
	tab = ref("overview"),
	money = useMoneyFormatter();
const controller = new AbortController(),
	typeInfo = computed(() =>
		record.value ? metadata.value.find((info) => info.agent_type === detectAgentType(record.value!)) : undefined,
	),
	dynamic = computed(() => Boolean(record.value && detectAgentType(record.value) !== "a2a" && typeInfo.value));
async function load() {
	loading.value = true;
	error.value = "";
	try {
		record.value = await agentsApi.detail(props.id, controller.signal);
		draft.value = parseAgentDraft(record.value, typeInfo.value);
	} catch {
		error.value = "Failed to load agent information";
	} finally {
		loading.value = false;
	}
}
function edit() {
	if (record.value) {
		draft.value = parseAgentDraft(record.value, typeInfo.value);
		errors.value = {};
		editing.value = true;
	}
}
async function save() {
	errors.value = agentEditErrors(draft.value, dynamic.value ? typeInfo.value : undefined);
	if (Object.keys(errors.value).length) return;
	if (!record.value) return;
	pending.value = true;
	try {
		const body =
			dynamic.value && typeInfo.value
				? dynamicAgentPayload(draft.value, typeInfo.value)
				: baseAgentPayload(draft.value, record.value);
		await agentsApi.update(props.id, body);
		emit("notice", "Agent updated successfully");
		editing.value = false;
		emit("changed");
		await load();
	} catch {
		emit("error", "Failed to update agent");
	} finally {
		pending.value = false;
	}
}
const details = computed(() => {
	const agent = record.value;
	if (!agent) return [];
	const card = agent.agent_card_params || {},
		items = [
			{ key: "id", label: "Agent ID", value: agent.agent_id },
			{ key: "name", label: "Agent Name", value: agent.agent_name },
			{ key: "display", label: "Display Name", value: card.name || "-" },
			{ key: "description", label: "Description", value: card.description || "-" },
			{ key: "url", label: "URL", value: card.url || "-" },
			{ key: "version", label: "Version", value: card.version || "-" },
			{ key: "protocol", label: "Protocol Version", value: card.protocolVersion || "-" },
			{ key: "streaming", label: "Streaming", value: card.capabilities?.streaming ? "Yes" : "No" },
		];
	if (card.capabilities?.pushNotifications) items.push({ key: "push", label: "Push Notifications", value: "Yes" });
	if (card.capabilities?.stateTransitionHistory) items.push({ key: "history", label: "State Transition History", value: "Yes" });
	items.push({ key: "skills", label: "Skills", value: (card.skills?.length || 0) + " configured" });
	if (agent.litellm_params.model) items.push({ key: "model", label: "Model", value: agent.litellm_params.model });
	if (agent.litellm_params.make_public !== undefined)
		items.push({ key: "public", label: "Make Public", value: agent.litellm_params.make_public ? "Yes" : "No" });
	if (card.iconUrl) items.push({ key: "icon", label: "Icon URL", value: card.iconUrl });
	if (card.documentationUrl) items.push({ key: "docs", label: "Documentation URL", value: card.documentationUrl });
	for (const key of rateLimitFields)
		items.push({
			key,
			label: {
				tpm_limit: "TPM Limit",
				rpm_limit: "RPM Limit",
				session_tpm_limit: "Session TPM Limit",
				session_rpm_limit: "Session RPM Limit",
			}[key],
			value: String(agent[key] ?? "Unlimited"),
		});
	for (const key of ["created_at", "updated_at"] as const)
		items.push({
			key,
			label: key === "created_at" ? "Created At" : "Updated At",
			value: agent[key] ? new Date(agent[key]).toLocaleString() : "-",
		});
	return items;
});
const costs = computed(() =>
	agentCostFields
		.filter((key) => record.value?.litellm_params[key] !== undefined)
		.map((key) => ({
			key,
			label: {
				cost_per_query: "Cost Per Query",
				input_cost_per_token: "Input Cost Per Token",
				output_cost_per_token: "Output Cost Per Token",
			}[key],
			value: formatMoney(record.value?.litellm_params[key]),
		})),
);
function formatMoney(value: unknown) {
	return money(typeof value === "number" || typeof value === "string" ? value : undefined, 4);
}
const permissions = computed(() => {
	const permission = record.value?.object_permission;
	return permission
		? [
				...(permission.mcp_servers?.length
					? [{ key: "servers", label: "MCP Servers", value: permission.mcp_servers.join(", ") }]
					: []),
				...(permission.mcp_access_groups?.length
					? [{ key: "groups", label: "MCP Access Groups", value: permission.mcp_access_groups.join(", ") }]
					: []),
				...(Object.keys(permission.mcp_tool_permissions || {}).length
					? [{ key: "tools", label: "Tool permissions per server", value: permission.mcp_tool_permissions }]
					: []),
			]
		: [];
});
onMounted(() => {
	void load();
	void agentsApi.metadata().then((value) => {
		metadata.value = value;
	});
});
onBeforeUnmount(() => controller.abort());
</script>
<template>
	<UiDrawer :open="true" :title="record?.agent_name || 'Agent details'" @update:open="!$event && emit('close')"
		><template #title
			><div>{{ record?.agent_name || "Agent details" }}</div>
			<div class="tools-drawer-subtitle">{{ record?.agent_id || id }}</div></template
		><template #extra
			><template v-if="admin && record"
				><div class="tools-agent-detail-actions">
					<UiButton variant="primary" @click="edit">Edit</UiButton
					><UiButton variant="danger" @click="emit('delete', record)">Delete</UiButton>
				</div></template
			></template
		>
		<p v-if="loading">Loading...</p>
		<UiAlert v-else-if="error" type="error" :title="error" show-icon><UiButton variant="link" @click="load">Retry</UiButton></UiAlert>
		<div v-else-if="record" class="tools-agent-details">
			<UiTabs v-model="tab" appearance="tremor" :items="[{ key: 'overview', label: 'Overview' }]" /><ToolDescriptionsComponent
				:items="details"
			/>
			<section v-if="costs.length">
				<h3>Cost Configuration</h3>
				<ToolDescriptionsComponent :items="costs" />
			</section>
			<section v-if="permissions.length">
				<h3>MCP Tool Permissions</h3>
				<ToolDescriptionsComponent :items="permissions"
					><template #tools
						><div v-for="(tools, server) in record.object_permission?.mcp_tool_permissions" :key="server">
							<strong>{{ server }}:</strong> {{ Array.isArray(tools) ? tools.join(", ") : String(tools) }}
						</div></template
					></ToolDescriptionsComponent
				>
			</section>
			<section v-if="record.agent_card_params?.skills?.length">
				<h3>Skills</h3>
				<ToolDescriptionsComponent
					:items="
						record.agent_card_params.skills.map((skill, index) => ({
							key: String(index),
							label: skill.name || 'Skill ' + (index + 1),
							value: skill,
						}))
					"
					><template v-for="(skill, index) in record.agent_card_params.skills" :key="index" #[String(index)]
						><div><strong>ID:</strong> {{ skill.id }}</div>
						<div><strong>Description:</strong> {{ skill.description }}</div>
						<div><strong>Tags:</strong> {{ Array.isArray(skill.tags) ? skill.tags.join(", ") : skill.tags }}</div>
						<div v-if="skill.examples?.length"><strong>Examples:</strong> {{ skill.examples.join(", ") }}</div></template
					></ToolDescriptionsComponent
				>
			</section>
			<UiDialog scroll-mode="overlay" v-model:open="editing" title="Edit Agent" :width="800" :show-footer="false"
				><form @submit.prevent="save">
					<AccessFieldComponent :model-value="record.agent_id" label="Agent ID" disabled /><AgentFieldsComponent
						v-model="draft"
						:dynamic="dynamic"
						:type-info="typeInfo"
						:errors="errors"
					/>
					<hr />
					<h3>Rate Limits</h3>
					<div class="tools-agent-rate-grid">
						<AccessFieldComponent
							v-for="key in rateLimitFields"
							:key="key"
							v-model="draft[key]"
							:label="
								{
									tpm_limit: 'TPM Limit',
									rpm_limit: 'RPM Limit',
									session_tpm_limit: 'Session TPM Limit',
									session_rpm_limit: 'Session RPM Limit',
								}[key]
							"
							type="number"
							:min="0"
							placeholder="Unlimited"
						/>
					</div>
					<footer class="tools-form-footer">
						<UiButton @click="editing = false">Cancel</UiButton
						><UiButton type="submit" variant="primary" :loading="pending">Save Changes</UiButton>
					</footer>
				</form></UiDialog
			>
		</div></UiDrawer
	>
</template>
