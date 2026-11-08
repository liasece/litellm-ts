<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiCard from "../../../platform/ui/UiCard.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { guardrailsMonitorApi } from "../../api/GuardrailsMonitorApi";
import { createMonitorRequestStore } from "../../stores/MonitorRequestStore";
import { monitorMetrics, sortMonitorRows, monitorColor } from "../../logic/GuardrailsMonitorLogic";
import MonitorMetricCardComponent from "./MonitorMetricCardComponent.vue";
import MonitorScoreChartComponent from "./MonitorScoreChartComponent.vue";
import MonitorEvaluationDialogComponent from "./MonitorEvaluationDialogComponent.vue";
const props = defineProps<{ startDate: string; endDate: string }>(),
	emit = defineEmits<{ select: [id: string] }>(),
	auth = useAuthenticationStore(),
	store = createMonitorRequestStore((signal) => guardrailsMonitorApi.overview(props.startDate, props.endDate, signal)),
	{ data, loading, error } = store,
	settings = ref(false),
	sort = ref({ key: "failRate", order: "desc" as "asc" | "desc" }),
	metrics = computed(() => monitorMetrics(data.value)),
	rows = computed(() => sortMonitorRows(data.value?.rows ?? [], sort.value.key, sort.value.order));
const columns = [
	{ key: "name", label: "Guardrail" },
	{ key: "provider", label: "Provider" },
	{ key: "requestsEvaluated", label: "Requests", numeric: true },
	{ key: "failRate", label: "Fail Rate", numeric: true },
	{ key: "avgLatency", label: "Avg. latency added", numeric: true },
	{ key: "status", label: "Status" },
];
function toggle(key: string) {
	sort.value = { key, order: sort.value.key === key && sort.value.order === "asc" ? "desc" : "asc" };
}
watch(
	() => [props.startDate, props.endDate, auth.isAuthorized.value],
	() => {
		if (auth.isAuthorized.value) void store.refresh();
	},
	{ immediate: true },
);
onBeforeUnmount(store.dispose);
function providerClass(value: string) {
	return value === "Bedrock" ? "orange" : value === "Google Cloud" ? "sky" : value === "LiteLLM" ? "indigo" : "gray";
}
</script>
<template>
	<div>
		<header class="monitor-overview-header">
			<div>
				<div>
					<UiIcon name="SafetyOutlined" :size="18" />
					<h1>Guardrails Monitor</h1>
				</div>
				<p>Monitor guardrail performance across all requests</p>
			</div>
			<UiButton title="Coming soon"><UiIcon name="DownloadOutlined" />Export Data</UiButton>
		</header>
		<div class="monitor-metrics-grid">
			<MonitorMetricCardComponent
				label="Total Evaluations"
				:value="metrics.totalRequests.toLocaleString()"
			/><MonitorMetricCardComponent label="Blocked Requests" :value="metrics.totalBlocked.toLocaleString()" color="red"
				><template #icon><UiIcon name="WarningOutlined" class="monitor-color-red-light" /></template></MonitorMetricCardComponent
			><MonitorMetricCardComponent label="Pass Rate" :value="metrics.passRate + '%'" color="green"
				><template #icon><UiIcon name="RiseOutlined" class="monitor-color-green-light" /></template></MonitorMetricCardComponent
			><MonitorMetricCardComponent
				label="Avg. latency added"
				:value="metrics.avgLatency + 'ms'"
				:color="monitorColor(metrics.avgLatency, 50, 150)"
			/><MonitorMetricCardComponent label="Active Guardrails" :value="metrics.count" />
		</div>
		<div class="monitor-chart-region"><MonitorScoreChartComponent :data="data?.chart" /></div>
		<UiCard class="monitor-performance-card"
			><div v-if="loading || error" class="monitor-loading-strip">
				<UiSpinner v-if="loading" :size="14" /><span v-if="error">Failed to load data. Try again.</span>
			</div>
			<header>
				<div>
					<h2>Guardrail Performance</h2>
					<p>Click a guardrail to view details, logs, and configuration</p>
				</div>
				<UiButton title="Evaluation settings" aria-label="Evaluation settings" @click="settings = true"
					><template #icon><UiIcon name="SettingOutlined" /></template
				></UiButton>
			</header>
			<div class="monitor-performance-table-region">
				<table class="monitor-performance-table">
					<thead>
						<tr>
							<th
								v-for="column in columns"
								:key="column.key"
								scope="col"
								:class="{
									numeric: column.numeric,
									status: column.key === 'status',
									sortable: column.numeric,
									sorted: sort.key === column.key,
								}"
								:aria-sort="
									column.numeric
										? sort.key === column.key
											? sort.order === 'asc'
												? 'ascending'
												: 'descending'
											: 'none'
										: undefined
								"
								:tabindex="column.numeric ? 0 : undefined"
								@click="column.numeric && toggle(column.key)"
								@keydown.enter.prevent="column.numeric && toggle(column.key)"
								@keydown.space.prevent="column.numeric && toggle(column.key)"
							>
								<div v-if="column.numeric" class="monitor-column-sorters">
									<span>{{ column.label }}</span
									><span class="monitor-sorter"
										><UiIcon
											name="CaretUpOutlined"
											:class="{ active: sort.key === column.key && sort.order === 'asc' }" /><UiIcon
											name="CaretDownOutlined"
											:class="{ active: sort.key === column.key && sort.order === 'desc' }"
									/></span>
								</div>
								<span v-else>{{ column.label }}</span>
							</th>
						</tr>
					</thead>
					<tbody>
						<tr v-if="!rows.length">
							<td :colspan="6" class="monitor-performance-empty">{{ !loading ? "No data for this period" : "No data" }}</td>
						</tr>
						<tr v-for="row in rows" :key="row.id" @click="emit('select', row.id)">
							<td>
								<button type="button" @click.stop="emit('select', row.id)">{{ row.name }}</button>
							</td>
							<td>
								<span :class="['monitor-provider-badge', 'is-' + providerClass(row.provider)]">{{ row.provider }}</span>
							</td>
							<td :class="['numeric', { sorted: sort.key === 'requestsEvaluated' }]">
								{{ row.requestsEvaluated.toLocaleString() }}
							</td>
							<td :class="['numeric', { sorted: sort.key === 'failRate' }]">
								<span :class="'monitor-color-' + monitorColor(row.failRate, 5, 15)"
									>{{ row.failRate }}%<small v-if="row.trend === 'up'" class="monitor-color-red-light">↑</small
									><small v-if="row.trend === 'down'" class="monitor-color-green-light">↓</small></span
								>
							</td>
							<td :class="['numeric', { sorted: sort.key === 'avgLatency' }]">
								<span :class="'monitor-color-' + monitorColor(row.avgLatency, 50, 150)">{{
									row.avgLatency != null ? row.avgLatency + "ms" : "—"
								}}</span>
							</td>
							<td class="status">
								<span class="monitor-status"
									><i :class="'is-' + row.status" /><span>{{ row.status }}</span></span
								>
							</td>
						</tr>
					</tbody>
				</table>
				<div v-if="loading" class="monitor-table-loading"><UiSpinner /></div></div></UiCard
		><MonitorEvaluationDialogComponent v-model:open="settings" />
	</div>
</template>
