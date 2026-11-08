<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
import UiTabs from "../../../platform/ui/UiTabs.vue";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { guardrailsMonitorApi } from "../../api/GuardrailsMonitorApi";
import { createMonitorRequestStore } from "../../stores/MonitorRequestStore";
import { monitorColor } from "../../logic/GuardrailsMonitorLogic";
import MonitorMetricCardComponent from "./MonitorMetricCardComponent.vue";
import MonitorLogViewerComponent from "./MonitorLogViewerComponent.vue";
import MonitorEvaluationDialogComponent from "./MonitorEvaluationDialogComponent.vue";
const props = defineProps<{ guardrailId: string; startDate: string; endDate: string }>(),
	emit = defineEmits<{ back: [] }>(),
	auth = useAuthenticationStore(),
	detail = createMonitorRequestStore((signal) => guardrailsMonitorApi.detail(props.guardrailId, props.startDate, props.endDate, signal)),
	logs = createMonitorRequestStore((signal) =>
		guardrailsMonitorApi.logs(
			{ guardrailId: props.guardrailId, page: 1, pageSize: 50, startDate: props.startDate, endDate: props.endDate },
			signal,
		),
	),
	tab = ref("overview"),
	settings = ref(false),
	data = computed(
		() =>
			detail.data.value ?? {
				guardrail_name: props.guardrailId,
				description: "",
				status: "healthy",
				provider: "—",
				type: "—",
				requestsEvaluated: 0,
				failRate: 0,
				avgScore: undefined,
				avgLatency: undefined,
			},
	);
watch(
	() => [props.guardrailId, props.startDate, props.endDate, auth.isAuthorized.value],
	() => {
		if (props.guardrailId && auth.isAuthorized.value) void detail.refresh();
	},
	{ immediate: true },
);
watch(
	() => [props.guardrailId, auth.isAuthorized.value],
	() => {
		if (props.guardrailId && auth.isAuthorized.value) void logs.refresh();
	},
	{ immediate: true },
);
onBeforeUnmount(() => {
	detail.dispose();
	logs.dispose();
});
</script>
<template>
	<div v-if="detail.loading.value && !detail.data.value" class="monitor-detail-loading"><UiSpinner :size="32" /></div>
	<div v-else-if="detail.error.value && !detail.data.value">
		<UiButton variant="link" class="monitor-back" @click="emit('back')"><UiIcon name="ArrowLeftOutlined" />Back to Overview</UiButton>
		<p class="monitor-color-red">Failed to load guardrail details.</p>
	</div>
	<div v-else class="monitor-detail">
		<header>
			<UiButton variant="link" class="monitor-back" @click="emit('back')"
				><UiIcon name="ArrowLeftOutlined" />Back to Overview</UiButton
			>
			<div>
				<div>
					<div>
						<UiIcon name="SafetyOutlined" :size="20" />
						<h1>{{ data.guardrail_name }}</h1>
						<span
							:class="[
								'monitor-detail-status',
								'is-' + (data.status === 'warning' || data.status === 'critical' ? data.status : 'healthy'),
							]"
							><i />{{ data.status.charAt(0).toUpperCase() + data.status.slice(1) }}</span
						>
					</div>
					<p>{{ data.description }}</p>
				</div>
				<div>
					<span class="monitor-detail-provider">{{ data.provider }}</span
					><UiButton title="Evaluation settings" aria-label="Evaluation settings" @click="settings = true"
						><template #icon><UiIcon name="SettingOutlined" /></template
					></UiButton>
				</div>
			</div>
		</header>
		<UiTabs
			v-model="tab"
			:items="[
				{ key: 'overview', label: 'Overview' },
				{ key: 'logs', label: 'Logs' },
			]"
		/>
		<div v-if="tab === 'overview'" class="monitor-detail-content">
			<div class="monitor-detail-metrics">
				<MonitorMetricCardComponent
					label="Requests Evaluated"
					:value="data.requestsEvaluated.toLocaleString()"
				/><MonitorMetricCardComponent
					label="Fail Rate"
					:value="data.failRate + '%'"
					:color="monitorColor(data.failRate, 5, 15)"
					:subtitle="Math.round((data.requestsEvaluated * data.failRate) / 100).toLocaleString() + ' blocked'"
					><template v-if="data.failRate > 15" #icon
						><UiIcon name="WarningOutlined" class="monitor-color-red-light" /></template></MonitorMetricCardComponent
				><MonitorMetricCardComponent
					label="Avg. latency added"
					:value="data.avgLatency != null ? Math.round(data.avgLatency) + 'ms' : '—'"
					:color="data.avgLatency != null ? monitorColor(data.avgLatency, 50, 150) : 'gray'"
					:subtitle="data.avgLatency != null ? 'Per request (avg)' : 'No data'"
				/>
			</div>
			<MonitorLogViewerComponent
				:guardrail-name="data.guardrail_name"
				:logs="logs.data.value?.logs ?? []"
				:logs-loading="logs.loading.value"
				:total-logs="logs.data.value?.total ?? 0"
				:start-date="startDate"
				:end-date="endDate"
			/>
		</div>
		<div v-else class="monitor-detail-logs">
			<MonitorLogViewerComponent
				:guardrail-name="data.guardrail_name"
				:logs="logs.data.value?.logs ?? []"
				:logs-loading="logs.loading.value"
				:total-logs="logs.data.value?.total ?? 0"
				:start-date="startDate"
				:end-date="endDate"
			/>
		</div>
		<MonitorEvaluationDialogComponent v-model:open="settings" :guardrail-name="data.guardrail_name" />
	</div>
</template>
