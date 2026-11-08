<script setup lang="ts">
import { reactive, computed, watch, onBeforeUnmount } from "vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import TeamDropdownComponent from "../../../access-control/ui/TeamDropdownComponent.vue";
import { accessApi } from "../../../access-control/api/AccessApi";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { toolPoliciesApi } from "../../api/ToolPoliciesApi";
import { createMonitorRequestStore } from "../../stores/MonitorRequestStore";
import type { ToolPolicyOverride, ToolKeyChoice } from "../../support/ToolPolicyModels";
import MonitorLogViewerComponent from "../monitor/MonitorLogViewerComponent.vue";
import ToolPolicySelectComponent from "./ToolPolicySelectComponent.vue";
const props = defineProps<{ toolName: string }>(),
	emit = defineEmits<{ back: [] }>(),
	auth = useAuthenticationStore(),
	end = new Date(),
	start = new Date();
start.setDate(start.getDate() - 90);
const format = (date: Date) => date.toISOString().slice(0, 19).replace("T", " "),
	range = { start: format(start), end: format(end) },
	detail = createMonitorRequestStore((signal) => toolPoliciesApi.detail(props.toolName, signal)),
	options = createMonitorRequestStore(toolPoliciesApi.options),
	keys = createMonitorRequestStore(toolPoliciesApi.keys),
	logs = createMonitorRequestStore((signal) =>
		toolPoliciesApi.logs(props.toolName, { page: 1, pageSize: 50, startDate: range.start, endDate: range.end }, signal),
	),
	state = reactive({
		overrideSaving: false,
		inputSaving: false,
		outputSaving: false,
		scope: "team",
		teamId: null as string | null,
		key: null as ToolKeyChoice | null,
	}),
	data = computed(() => detail.data.value),
	logRows = computed(() =>
		(logs.data.value?.logs ?? []).map((log) => ({
			id: log.id,
			timestamp: log.timestamp,
			action: "passed" as const,
			model: log.model ?? undefined,
			input_snippet: log.input_snippet ?? undefined,
		})),
	);
watch(
	() => [props.toolName, auth.isAuthorized.value],
	() => {
		if (!auth.isAuthorized.value || !props.toolName) return;
		void detail.refresh();
		void options.refresh();
		void keys.refresh();
		void logs.refresh();
		void accessApi.allTeams().catch(() => {
			/* The original detail also performs this optional catalogue lookup. */
		});
	},
	{ immediate: true },
);
function error(prefix: string, value: unknown) {
	window.alert(prefix + ": " + (value instanceof Error ? value.message : String(value)));
}
async function policy(_name: string, value: string, type: "input" | "output") {
	if (!auth.isAuthorized.value) return;
	const flag = type === "input" ? "inputSaving" : "outputSaving";
	state[flag] = true;
	try {
		await toolPoliciesApi.update(props.toolName, { [type === "input" ? "input_policy" : "output_policy"]: value });
		void detail.refresh(true);
	} catch (reason) {
		error("Failed to update " + type + " policy", reason);
	} finally {
		state[flag] = false;
	}
}
async function addOverride() {
	if (!auth.isAuthorized.value || !props.toolName) return;
	const team = state.scope === "team";
	if (team ? !state.teamId : !state.key?.token) return;
	state.overrideSaving = true;
	try {
		await toolPoliciesApi.update(
			props.toolName,
			{ input_policy: "blocked" },
			{
				team_id: team ? state.teamId : undefined,
				key_hash: !team ? state.key?.token : undefined,
				key_alias: !team ? state.key?.key_alias : undefined,
			},
		);
		void detail.refresh(true);
		state.teamId = null;
		state.key = null;
	} catch (reason) {
		error("Failed to add override", reason);
	} finally {
		state.overrideSaving = false;
	}
}
async function remove(override: ToolPolicyOverride) {
	if (!auth.isAuthorized.value || !props.toolName) return;
	state.overrideSaving = true;
	try {
		await toolPoliciesApi.deleteOverride(props.toolName, {
			team_id: override.team_id ?? undefined,
			key_hash: override.key_hash ?? undefined,
		});
		void detail.refresh(true);
	} catch (reason) {
		error("Failed to remove override", reason);
	} finally {
		state.overrideSaving = false;
	}
}
function chooseKey(value: unknown) {
	state.key = keys.data.value?.find((key) => key.token === value) ?? null;
}
function description(type: "input" | "output") {
	return options.data.value?.[type === "input" ? "input_policies" : "output_policies"].find(
		(option) => option.value === data.value?.tool[type === "input" ? "input_policy" : "output_policy"],
	)?.description;
}
onBeforeUnmount(() => {
	detail.dispose();
	options.dispose();
	keys.dispose();
	logs.dispose();
});
</script>
<template>
	<div v-if="detail.loading.value && !data" class="monitor-detail-loading"><UiSpinner :size="32" /></div>
	<div v-else-if="detail.error.value && !data">
		<UiButton variant="link" class="monitor-back" @click="emit('back')"
			><UiIcon name="ArrowLeftOutlined" />Back to Tool Policies</UiButton
		>
		<p class="monitor-color-red">Failed to load tool details.</p>
	</div>
	<div v-else-if="data" class="tool-policy-detail">
		<header>
			<UiButton variant="link" class="monitor-back" @click="emit('back')"
				><UiIcon name="ArrowLeftOutlined" />Back to Tool Policies</UiButton
			>
			<div>
				<UiIcon name="ToolOutlined" :size="20" />
				<h1>{{ data.tool.tool_name }}</h1>
				<span>{{ data.tool.origin ?? "—" }}</span
				><span>{{ (data.tool.call_count ?? 0).toLocaleString() }} calls</span>
			</div>
			<dl>
				<div v-if="data.tool.user_agent">
					<dt>User Agent:</dt>
					<dd :title="data.tool.user_agent" class="tool-user-agent">{{ data.tool.user_agent }}</dd>
				</div>
				<div v-if="data.tool.created_at">
					<dt>First Discovered:</dt>
					<dd>{{ new Date(data.tool.created_at).toLocaleString() }}</dd>
				</div>
				<div v-if="data.tool.last_used_at">
					<dt>Last Used:</dt>
					<dd>{{ new Date(data.tool.last_used_at).toLocaleString() }}</dd>
				</div>
			</dl>
		</header>
		<div class="tool-detail-sections">
			<div class="tool-detail-policy-panels">
				<section v-for="kind in ['input', 'output'] as const" :key="kind">
					<h2>{{ kind === "input" ? "Input" : "Output" }} Policy</h2>
					<p>
						{{
							description(kind) ??
							(kind === "input"
								? "Controls what data this tool is allowed to accept."
								: "Controls how this tool's output is trusted by downstream tools.")
						}}
					</p>
					<ToolPolicySelectComponent
						:value="data.tool[kind === 'input' ? 'input_policy' : 'output_policy']"
						:tool-name="data.tool.tool_name"
						:saving="kind === 'input' ? state.inputSaving : state.outputSaving"
						:policy-type="kind"
						size="middle"
						:min-width="140"
						:stop-propagation="false"
						@change="(name, value) => policy(name, value, kind)"
					/>
				</section>
			</div>
			<section v-if="data.overrides.length" class="tool-detail-override-section">
				<h2>Blocked for team or key</h2>
				<ul>
					<li v-for="override in data.overrides" :key="override.override_id">
						<span
							>{{ override.team_id ? "Team: " + override.team_id : "" }}{{ override.team_id && override.key_hash ? " · " : ""
							}}{{ override.key_hash ? "Key: " + (override.key_alias || override.key_hash.substring(0, 8)) : ""
							}}{{ !override.team_id && !override.key_hash ? "—" : "" }}</span
						><UiButton variant="link" danger size="small" :disabled="state.overrideSaving" @click="remove(override)"
							>Remove</UiButton
						>
					</li>
				</ul>
			</section>
			<section class="tool-detail-block-section">
				<h2>Block for team or key</h2>
				<div>
					<div>
						<span>Scope</span>
						<div>
							<label><input v-model="state.scope" type="radio" value="team" />Team</label
							><label><input v-model="state.scope" type="radio" value="key" />Key</label>
						</div>
					</div>
					<div>
						<span>{{ state.scope === "team" ? "Team" : "Key" }}</span
						><TeamDropdownComponent v-if="state.scope === 'team'" v-model="state.teamId" /><UiSelect
							v-else
							:model-value="state.key?.token"
							:options="
								(keys.data.value ?? []).map((key) => ({
									value: key.token,
									label: key.key_alias || key.token.substring(0, 12) || key.token,
								}))
							"
							placeholder="Select key"
							clearable
							searchable
							style="min-width: 200px"
							@update:model-value="chooseKey"
						/>
					</div>
					<UiButton
						variant="primary"
						danger
						:disabled="state.overrideSaving || (state.scope === 'team' ? !state.teamId : !state.key?.token)"
						:loading="state.overrideSaving"
						@click="addOverride"
						>Block for {{ state.scope }}</UiButton
					>
				</div>
			</section>
			<section class="tool-detail-recent-logs">
				<h2><UiIcon name="HistoryOutlined" />Recent logs</h2>
				<MonitorLogViewerComponent
					:guardrail-name="data.tool.tool_name"
					filter-action="passed"
					:logs="logRows"
					:logs-loading="logs.loading.value"
					:total-logs="logs.data.value?.total ?? 0"
					:start-date="range.start"
					:end-date="range.end"
				/>
			</section>
		</div>
	</div>
</template>
