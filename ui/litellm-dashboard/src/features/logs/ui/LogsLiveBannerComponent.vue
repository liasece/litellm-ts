<script setup lang="ts">
import { computed } from "vue";
import { LIVE_TAIL_INTERVAL_OPTIONS } from "../support/LogsConstants";
const props = defineProps<{ visible: boolean; intervalMs: number; connected: boolean }>();
defineEmits<{ stop: [] }>();
const interval = computed(
	() => LIVE_TAIL_INTERVAL_OPTIONS.find((item) => item.value === props.intervalMs)?.label ?? props.intervalMs + "ms",
);
</script>
<template>
	<div v-if="visible" class="logs-live-banner" :class="{ 'logs-live-banner-connected': connected }">
		<span
			>{{ connected ? "Live updates on change; idle refresh every " : "Live tail reconnecting; idle refresh every "
			}}{{ interval }}</span
		>
		<button type="button" @click="$emit('stop')">Stop</button>
	</div>
</template>
