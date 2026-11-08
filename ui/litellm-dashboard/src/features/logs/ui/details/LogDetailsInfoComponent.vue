<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { LogEntry } from "../../support/LogsModels";
import { cacheTokens, costView } from "../../logic/LogDetailsMetricsLogic";
import { detailDate } from "../../logic/LogDetailsDisplayLogic";
import { useMoneyFormatter } from "../../../platform/stores/PriceDisplayStore";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import LogDetailsCollapseComponent from "./LogDetailsCollapseComponent.vue";
import LogDetailsCostsComponent from "./LogDetailsCostsComponent.vue";
const props = defineProps<{ log: LogEntry; inProgress: boolean }>();
const money = useMoneyFormatter(),
	now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => (timer = setInterval(() => (now.value = Date.now()), 1000)));
onBeforeUnmount(() => {
	if (timer) clearInterval(timer);
});
const metadata = computed(() => props.log.metadata ?? {}),
	readCache = computed(() => cacheTokens(metadata.value, "read")),
	writeCache = computed(() => cacheTokens(metadata.value, "creation"));
const duration = computed(() =>
	props.inProgress
		? Math.max(0, now.value - new Date(props.log.startTime).getTime())
		: (props.log.request_duration_ms ??
			(props.log.endTime ? new Date(props.log.endTime).getTime() - new Date(props.log.startTime).getTime() : null)),
);
const ttft = computed(() =>
	props.log.completionStartTime && props.log.completionStartTime !== props.log.endTime
		? new Date(props.log.completionStartTime).getTime() - new Date(props.log.startTime).getTime()
		: null,
);
const observed = computed(() => (props.log.prompt_tokens ?? 0) + (props.log.completion_tokens ?? 0) + (props.log.total_tokens ?? 0) > 0);
const totalTokens = computed(() => props.log.total_tokens ?? (props.log.prompt_tokens ?? 0) + (props.log.completion_tokens ?? 0));
const costs = computed(() =>
	costView(
		metadata.value.cost_breakdown,
		props.log.spend ?? 0,
		props.log.prompt_tokens,
		props.log.completion_tokens,
		props.log.cache_hit,
	),
);
const cacheValue = computed(() => String(props.log.cache_hit ?? "None"));
</script>
<template>
	<LogDetailsCollapseComponent label="Detail Info" body-class="ld-info-body"
		><template #label
			><div class="ld-info-heading">
				<h3>Detail Info</h3>
				<div class="ld-info-summary">
					<span
						>Tokens: <strong>{{ inProgress && !observed ? "—" : totalTokens.toLocaleString() }}</strong></span
					><span
						>Duration: <strong>{{ duration !== null ? (duration / 1000).toFixed(3) + " s" : "—" }}</strong></span
					><span
						>Total:
						<strong>{{ inProgress ? "—" : money(log.spend ?? 0, 8, log) + (costs.isCached ? " (Cached)" : "") }}</strong></span
					>
				</div>
			</div></template
		>
		<div class="ld-descriptions">
			<div>
				<span>Tokens</span><span v-if="inProgress && !observed" class="ld-pending">等待上游首个响应</span
				><span v-else class="ld-token-flow"
					>{{ (log.prompt_tokens ?? 0).toLocaleString() }} <UiIcon name="ArrowRightOutlined" />
					{{ (log.completion_tokens ?? 0).toLocaleString() }}
					<span class="ld-secondary">/ {{ totalTokens.toLocaleString() }}</span
					><UiTag v-if="inProgress" color="processing">partial</UiTag></span
				>
			</div>
			<div>
				<span>Duration</span
				><span
					>{{ duration !== null ? (duration / 1000).toFixed(3) : "-" }} s<span v-if="inProgress" class="ld-pending">
						(running)</span
					></span
				>
			</div>
			<div v-if="ttft !== null && ttft > 0">
				<span>Time to First Token</span><span>{{ (ttft / 1000).toFixed(3) }} s</span>
			</div>
			<template v-if="log.cache_hit || readCache > 0 || writeCache > 0"
				><div>
					<span>Cache Hit</span
					><UiTag
						:color="cacheValue.toLowerCase() === 'true' ? 'green' : cacheValue.toLowerCase() === 'false' ? 'red' : 'default'"
						>{{ cacheValue }}</UiTag
					>
				</div>
				<div v-if="readCache > 0">
					<span>Cache Read Tokens</span><span>{{ readCache.toLocaleString() }}</span>
				</div>
				<div v-if="writeCache > 0">
					<span>Cache Creation Tokens</span><span>{{ writeCache.toLocaleString() }}</span>
				</div></template
			>
			<div v-if="typeof metadata.litellm_overhead_time_ms === 'number'">
				<span>LiteLLM Overhead</span><span>{{ metadata.litellm_overhead_time_ms.toFixed(2) }} ms</span>
			</div>
			<div>
				<span>Retries</span
				><span v-if="typeof metadata.attempted_retries === 'number' && metadata.attempted_retries > 0"
					>{{ metadata.attempted_retries
					}}{{ metadata.max_retries !== undefined && metadata.max_retries !== null ? " / " + metadata.max_retries : "" }}</span
				><UiTag v-else-if="metadata.attempted_retries !== undefined && metadata.attempted_retries !== null" color="green"
					>None</UiTag
				><span v-else>-</span>
			</div>
			<div>
				<span>Start Time</span><span>{{ detailDate(log.startTime, true) }}</span>
			</div>
			<div>
				<span>End Time</span
				><span :class="{ 'ld-pending': inProgress }">{{ inProgress ? "—" : detailDate(log.endTime, true) }}</span>
			</div>
		</div>
		<div v-if="costs.visible" class="ld-info-costs"><LogDetailsCostsComponent :log="log" /></div>
	</LogDetailsCollapseComponent>
</template>
