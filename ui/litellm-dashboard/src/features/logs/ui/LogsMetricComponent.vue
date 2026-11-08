<script setup lang="ts">
import { computed } from "vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
const props = withDefaults(
	defineProps<{
		value: number;
		maxValue: number;
		color?: "red" | "green" | "blue";
		label?: string;
		display?: string;
		tooltip?: string;
		testId?: string;
		token?: boolean;
	}>(),
	{ color: "red", label: undefined, display: undefined, tooltip: undefined, testId: undefined },
);
const hidden = computed(() => 100 - Math.min(Math.max((props.value / props.maxValue) * 100, 0), 100));
</script>
<template>
	<UiTooltip v-if="tooltip" :content="tooltip"
		><span class="logs-metric logs-mono" :class="'logs-metric-' + color" :aria-label="label"
			><span
				class="logs-metric-gradient"
				:style="{ clipPath: 'inset(0 ' + hidden + '% 0 0)' }"
				:data-testid="testId"
				aria-hidden="true"
			/><span class="logs-metric-value"
				><slot>{{ display }}</slot></span
			></span
		></UiTooltip
	>
	<span v-else class="logs-metric logs-mono" :class="'logs-metric-' + color" :aria-label="label"
		><span
			class="logs-metric-gradient"
			:style="{ clipPath: 'inset(0 ' + hidden + '% 0 0)' }"
			:data-testid="testId"
			aria-hidden="true"
		/><span class="logs-metric-value"
			><slot>{{ display }}</slot></span
		></span
	>
</template>
