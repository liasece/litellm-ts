<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
import { logsApi } from "../../../logs/api/LogsApi";
import type { LogEntry } from "../../../logs/support/LogsModels";
import LogDetailsDrawerComponent from "../../../logs/ui/details/LogDetailsDrawerComponent.vue";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { sampleMonitorLogs, monitorSpendWindow } from "../../logic/GuardrailsMonitorLogic";
import type { GuardrailsMonitorLog } from "../../support/GuardrailsMonitorModels";
import "../../styles/MonitorLogsStyles.css";
const props = withDefaults(
		defineProps<{
			guardrailName?: string;
			filterAction?: string;
			logs?: GuardrailsMonitorLog[];
			logsLoading?: boolean;
			totalLogs?: number;
			startDate?: string;
			endDate?: string;
		}>(),
		{
			guardrailName: undefined,
			filterAction: "all",
			logs: () => [],
			logsLoading: false,
			totalLogs: undefined,
			startDate: "",
			endDate: "",
		},
	),
	auth = useAuthenticationStore(),
	sample = ref(10),
	filter = ref(props.filterAction),
	selected = ref(""),
	drawer = ref(false),
	fullLog = ref<LogEntry | null>(null),
	display = computed(() => sampleMonitorLogs(props.logs, filter.value, sample.value)),
	total = computed(() => props.totalLogs ?? props.logs.length),
	windowRange = computed(() => monitorSpendWindow(props.startDate, props.endDate)),
	filters = ["all", "blocked", "flagged", "passed"];
let generation = 0;
const actions = {
	blocked: { icon: "CloseOutlined", label: "Blocked", color: "red" },
	passed: { icon: "CheckCircleOutlined", label: "Passed", color: "green" },
	flagged: { icon: "WarningOutlined", label: "Flagged", color: "amber" },
};
watch(
	() => [selected.value, drawer.value, windowRange.value.startTime, windowRange.value.endTime, auth.isAuthorized.value],
	async () => {
		const current = ++generation;
		fullLog.value = null;
		if (!selected.value || !drawer.value || !auth.isAuthorized.value) return;
		const params = new URLSearchParams({
			start_date: windowRange.value.startTime,
			end_date: windowRange.value.endTime,
			page: "1",
			page_size: "10",
			request_id: selected.value,
		});
		try {
			const result = await logsApi.list(params);
			if (current === generation) fullLog.value = result.data[0] ?? null;
		} catch {
			/* The existing monitor leaves the detail drawer unopened when its request lookup fails. */
		}
	},
	{ immediate: true },
);
function close() {
	drawer.value = false;
	selected.value = "";
}
function open(log: GuardrailsMonitorLog) {
	selected.value = log.id;
	drawer.value = true;
}
onBeforeUnmount(() => ++generation);
</script>
<template>
	<div class="monitor-log-viewer">
		<header>
			<div>
				<div>
					<h3>{{ guardrailName ? "Logs — " + guardrailName : "Request Logs" }}</h3>
					<p>
						{{
							logsLoading
								? "Loading…"
								: logs.length
									? "Showing " + display.length + " of " + total + " entries"
									: "No logs for this period. Select a guardrail and date range."
						}}
					</p>
				</div>
				<div v-if="logs.length" class="monitor-log-controls">
					<div>
						<UiButton
							v-for="choice in filters"
							:key="choice"
							size="small"
							:variant="filter === choice ? 'primary' : 'default'"
							@click="filter = choice"
							>{{ choice.charAt(0).toUpperCase() + choice.slice(1) }}</UiButton
						>
					</div>
					<span />
					<div>
						<small>Sample:</small
						><UiButton
							v-for="size in [10, 50, 100]"
							:key="size"
							size="small"
							:variant="sample === size ? 'primary' : 'default'"
							@click="sample = size"
							>{{ size }}</UiButton
						>
					</div>
				</div>
			</div>
		</header>
		<div v-if="logsLoading" class="monitor-log-empty"><UiSpinner /></div>
		<div v-else-if="!display.length" class="monitor-log-empty">No logs to display. Adjust filters or date range.</div>
		<div v-else class="monitor-log-entries">
			<button v-for="log in display" :key="log.id" type="button" @click="open(log)">
				<UiIcon :name="actions[log.action].icon" :class="'monitor-color-' + actions[log.action].color" :size="14" />
				<div>
					<header>
						<span :class="'monitor-action-' + actions[log.action].color">{{ actions[log.action].label }}</span
						><small>{{ log.timestamp }}</small
						><small>·</small><small v-if="log.model" class="monitor-log-model">{{ log.model }}</small>
					</header>
					<p>{{ log.input_snippet ?? log.input ?? "—" }}</p>
				</div>
				<UiIcon name="DownOutlined" :size="14" />
			</button>
		</div>
		<LogDetailsDrawerComponent
			v-if="drawer"
			:open="drawer"
			:log="fullLog"
			:all-logs="fullLog ? [fullLog] : []"
			:start-time="windowRange.startTime"
			@close="close"
		/>
	</div>
</template>
