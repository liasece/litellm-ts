<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { LogEntry, SessionGroupRef } from "../../support/LogsModels";
import type { SessionTimelineEvent } from "../../support/SessionTimelineModels";
import { createLogDetailsStore } from "../../stores/LogDetailsStore";
import { loadCompleteSessionLogs } from "../../logic/SessionLogsLogic";
import { eventDisplayName, guardrailEntries, isAgent, isMcp, sessionStats } from "../../logic/LogDetailsDisplayLogic";
import { safeSessionError } from "../../logic/SessionTimelineMergeLogic";
import { useMoneyFormatter } from "../../../platform/stores/PriceDisplayStore";
import UiDrawer from "../../../platform/ui/UiDrawer.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
import UiAlert from "../../../platform/ui/UiAlert.vue";
import LogDetailsHeaderComponent from "./LogDetailsHeaderComponent.vue";
import LogDetailContentComponent from "./LogDetailContentComponent.vue";
import SessionSimulationDrawerComponent from "./session/SessionSimulationDrawerComponent.vue";
import "./LogDetailsStyles.css";
import "./LogDetailsLayoutStyles.css";
import "./LogDetailsRoutingStyles.css";
import "./PrettyMessagesStyles.css";
import "./LogDetailsDiffStyles.css";
const props = withDefaults(
	defineProps<{
		open: boolean;
		log: LogEntry | null;
		sessionGroup?: SessionGroupRef | null;
		allLogs: LogEntry[];
		teamId?: string;
		startTime: string;
		upstreamLogsEnabled?: boolean;
	}>(),
	{ sessionGroup: null, teamId: undefined, upstreamLogsEnabled: undefined },
);
const emit = defineEmits<{ close: []; select: [log: LogEntry]; refresh: []; "open-settings": [] }>();
const money = useMoneyFormatter(),
	details = createLogDetailsStore({ settled: () => emit("refresh") });
const selectedId = ref<string | null>(null),
	sidebarCollapsed = ref(false),
	simulationOpen = ref(false),
	sessionRows = shallowRef<LogEntry[]>([]),
	sessionLoading = ref(false),
	sessionError = ref<string | null>(null);
let sessionController: AbortController | undefined,
	sessionEpoch = 0;
const sessionMode = computed(() => Boolean(props.sessionGroup));
const rows = computed(() =>
	sessionMode.value
		? sessionRows.value.length
			? sessionRows.value
			: props.log
				? [props.log]
				: []
		: current.value
			? [current.value]
			: [],
);
const current = computed(() => {
	if (sessionMode.value) {
		const values = sessionRows.value.length ? sessionRows.value : props.log ? [props.log] : [];
		return (
			values.find((log) => log.request_id === selectedId.value) ??
			values.find((log) => log.request_id === props.log?.request_id) ??
			values[0] ??
			null
		);
	}
	return props.allLogs.find((log) => log.request_id === props.log?.request_id) ?? props.log;
});
const stats = computed(() => sessionStats(rows.value)),
	leftId = computed(() => (sessionMode.value ? (props.sessionGroup?.id ?? "") : (current.value?.request_id ?? "")));
const guardrails = computed(() => guardrailEntries(current.value?.metadata?.guardrail_information));
const allGuardrailsPassed = computed(() =>
	guardrails.value.every((entry) => ["pass", "passed", "success"].includes(String(entry.guardrail_status || entry.status))),
);
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | undefined;
async function copyId() {
	try {
		await navigator.clipboard.writeText(leftId.value);
		copied.value = true;
		if (copyTimer) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied.value = false), 1200);
	} catch {
		copied.value = false;
	}
}
async function refreshSession() {
	sessionController?.abort();
	sessionController = new AbortController();
	const signal = sessionController.signal,
		epoch = ++sessionEpoch;
	if (!props.open || !props.sessionGroup) {
		sessionRows.value = [];
		sessionLoading.value = false;
		sessionError.value = null;
		return;
	}
	sessionLoading.value = true;
	sessionError.value = null;
	const group = props.sessionGroup,
		teamId = props.teamId;
	try {
		const result = await loadCompleteSessionLogs(group, { teamId, signal });
		if (epoch === sessionEpoch && !signal.aborted) sessionRows.value = result;
	} catch (error) {
		if (epoch === sessionEpoch && !signal.aborted) sessionError.value = safeSessionError(error, "Session logs request failed");
	} finally {
		if (epoch === sessionEpoch) sessionLoading.value = false;
	}
}
watch(
	[() => props.open, () => props.sessionGroup?.type, () => props.sessionGroup?.id, () => props.teamId],
	() => {
		sessionRows.value = [];
		void refreshSession();
	},
	{ immediate: true },
);
watch(
	[() => props.open, () => props.log?.request_id],
	() => {
		if (props.open) {
			sidebarCollapsed.value = false;
			selectedId.value = props.log?.request_id ?? null;
		} else {
			selectedId.value = null;
			copied.value = false;
			simulationOpen.value = false;
		}
	},
	{ immediate: true },
);
watch([current, () => props.startTime, () => props.open], () => details.bind(current.value, props.startTime, props.open), {
	immediate: true,
});
function select(row: LogEntry) {
	if (sessionMode.value) selectedId.value = row.request_id;
	emit("select", row);
}
function navigate(offset: number) {
	if (!current.value) return;
	const values = sessionMode.value ? rows.value : props.allLogs,
		index = values.findIndex((row) => row.request_id === current.value?.request_id),
		target = values[index + offset];
	if (target) select(target);
}
function refresh() {
	void details.refresh();
	emit("refresh");
}
function keydown(event: KeyboardEvent) {
	if (
		!props.open ||
		simulationOpen.value ||
		event.target instanceof HTMLInputElement ||
		event.target instanceof HTMLTextAreaElement ||
		event.target instanceof HTMLSelectElement ||
		(event.target instanceof HTMLElement && event.target.isContentEditable)
	)
		return;
	if (event.key === "j" || event.key === "J") navigate(1);
	else if (event.key === "k" || event.key === "K") navigate(-1);
}
function openTimelineLog(event: SessionTimelineEvent) {
	selectedId.value = event.request_id;
	simulationOpen.value = false;
	const row = rows.value.find((row) => row.request_id === event.request_id);
	if (row) emit("select", row);
}
function duration(row: LogEntry) {
	return row.request_duration_ms != null
		? (row.request_duration_ms / 1000).toFixed(3)
		: row.startTime && row.endTime
			? ((Date.parse(row.endTime) - Date.parse(row.startTime)) / 1000).toFixed(3)
			: "-";
}
function jumpGuardrail() {
	document.getElementById("guardrail-section")?.scrollIntoView({ behavior: "smooth" });
}
onMounted(() => window.addEventListener("keydown", keydown));
onBeforeUnmount(() => {
	details.dispose();
	sessionEpoch++;
	sessionController?.abort();
	if (copyTimer) clearTimeout(copyTimer);
	window.removeEventListener("keydown", keydown);
});
</script>
<template>
	<UiDrawer
		v-if="current && details.enriched.value"
		:open="open"
		:closable="false"
		width="min(1800px, calc(100vw - 32px))"
		aria-label="Log details"
		class="log-details-drawer"
		@close="emit('close')"
		><div class="ld-layout">
			<UiButton
				class="ld-sidebar-toggle"
				variant="text"
				size="small"
				:aria-label="sidebarCollapsed ? 'Expand trace sidebar' : 'Collapse trace sidebar'"
				@click="sidebarCollapsed = !sidebarCollapsed"
				><UiIcon :name="sidebarCollapsed ? 'RightOutlined' : 'LeftOutlined'"
			/></UiButton>
			<aside v-if="!sidebarCollapsed" class="ld-sidebar">
				<div class="ld-sidebar__header">
					<div class="ld-sidebar__heading">
						<div class="ld-sidebar__identity">
							<div>{{ sessionMode ? "Session" : "Trace" }}</div>
							<span
								>{{ leftId.length > 14 ? leftId.slice(0, 11) + "..." : leftId
								}}<button type="button" aria-label="Copy trace id" @click="copyId">
									<UiIcon :name="copied ? 'CheckOutlined' : 'CopyOutlined'" /></button
							></span>
						</div>
						<UiButton
							v-if="sessionMode"
							size="small"
							class="ld-simulate"
							aria-label="模拟 Session"
							@click="simulationOpen = true"
							><template #icon><UiIcon name="PlayCircleOutlined" /></template>模拟</UiButton
						>
					</div>
					<div class="ld-sidebar__stats">
						<span v-if="sessionMode && sessionLoading">Loading all session logs…</span
						><template v-else
							>{{ rows.length }} req<template
								v-for="[count, label] in [
									[stats.llm, ' LLM'],
									[stats.agent, ' Agent'],
									[stats.mcp, ' MCP'],
								]"
								:key="String(label)"
								><span v-if="Number(count) > 0"><b>·</b>{{ count }}{{ label }}</span></template
							><b>·</b
							>{{ sessionMode ? money(stats.spend) : details.inProgress.value ? "—" : money(current.spend ?? 0, 6, current)
							}}<template v-if="sessionMode"><b>·</b>{{ stats.duration.toFixed(2) }}s</template></template
						>
					</div>
				</div>
				<div class="ld-sidebar__scroll">
					<div v-if="guardrails.length" class="ld-sidebar__guardrails">
						<button
							type="button"
							class="ld-guardrail-jump"
							:class="{ 'ld-guardrail-jump--failed': !allGuardrailsPassed }"
							@click="jumpGuardrail"
						>
							{{ allGuardrailsPassed ? "✓" : "✗" }} {{ guardrails.length }} guardrail{{
								guardrails.length === 1 ? "" : "s"
							}}
							evaluated <span>↓</span>
						</button>
					</div>
					<div class="ld-trace-list" :class="{ 'ld-trace-list--session': sessionMode }">
						<div
							v-for="(row, index) in rows"
							:key="row.request_id"
							class="ld-trace-list__item"
							:class="{ 'ld-trace-list__item--last': index === rows.length - 1 }"
						>
							<button
								type="button"
								class="ld-trace-row"
								:class="{ 'ld-trace-row--selected': row.request_id === current.request_id }"
								@click="select(row)"
							>
								<span class="ld-trace-row__model"
									><UiLucideIcon :name="isMcp(row) ? 'Wrench' : isAgent(row) ? 'Bot' : 'Sparkles'" :size="12" /><span>{{
										eventDisplayName(row)
									}}</span></span
								><span class="ld-trace-row__metrics"
									><span>{{ duration(row) }}s</span
									><template v-if="row.spend"
										><span>·</span><span>{{ money(row.spend, 6, row) }}</span></template
									><template v-if="row.total_tokens"
										><span>·</span><span>{{ row.total_tokens.toLocaleString() }} tok</span></template
									></span
								>
							</button>
						</div>
					</div>
				</div>
			</aside>
			<main class="ld-main">
				<LogDetailsHeaderComponent
					:log="current"
					:in-progress="details.inProgress.value"
					@close="emit('close')"
					@previous="navigate(-1)"
					@next="navigate(1)"
					@refresh="refresh"
				/><UiAlert v-if="sessionMode && sessionError" type="warning" title="完整 Session 加载失败"
					>当前仅显示单请求。{{ sessionError
					}}<template #action
						><UiButton size="small" :loading="sessionLoading" @click="refreshSession">Retry</UiButton></template
					></UiAlert
				>
				<div class="ld-main__scroll">
					<LogDetailContentComponent
						:log="details.enriched.value"
						:in-progress="details.inProgress.value"
						:loading="details.state.loading"
						:upstream-logs-enabled="upstreamLogsEnabled"
						@open-settings="emit('open-settings')"
					/>
				</div>
			</main>
		</div>
		<SessionSimulationDrawerComponent
			v-if="sessionGroup"
			:open="simulationOpen"
			:session-group="sessionGroup"
			:team-id="teamId"
			@close="simulationOpen = false"
			@open-log="openTimelineLog"
	/></UiDrawer>
</template>
