<script setup lang="ts">
import { computed } from "vue";
import { durationMs } from "../logic/LogsPresentationLogic";
import { useLiveDurationClock } from "../stores/LiveDurationClock";
import LogsMetricComponent from "./LogsMetricComponent.vue";
const props = defineProps<{ startTime: string; serverDuration?: number | null }>();
const now = useLiveDurationClock();
const ms = computed(() => durationMs(props.startTime, props.serverDuration, now.value));
</script>
<template>
	<LogsMetricComponent
		:value="ms / 1000"
		:max-value="30"
		:display="(ms / 1000).toFixed(2)"
		:tooltip="ms + 'ms'"
		:label="'Duration ' + (ms / 1000).toFixed(2) + ' seconds'"
		test-id="duration-progress"
	/>
</template>
