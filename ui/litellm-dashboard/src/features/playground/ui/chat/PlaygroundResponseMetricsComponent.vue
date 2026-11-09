<script setup lang="ts">
import { computed } from "vue";
import type { PlaygroundResponseUsage } from "../../support/PlaygroundResponseMetricsModels";
import { useMoneyFormatter } from "../../../platform/stores/PriceDisplayStore";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
const props = defineProps<{
		model?: string;
		timeToFirstToken?: number;
		totalLatency?: number;
		usage?: PlaygroundResponseUsage;
	}>(),
	money = useMoneyFormatter(),
	shown = computed(() => Boolean(props.timeToFirstToken || props.totalLatency || props.usage)),
	usage = computed(() =>
		props.usage
			? {
					promptTokens: props.usage.promptTokens ?? props.usage.prompt_tokens,
					completionTokens: props.usage.completionTokens ?? props.usage.completion_tokens,
					reasoningTokens: props.usage.reasoningTokens ?? props.usage.reasoning_tokens,
					totalTokens: props.usage.totalTokens ?? props.usage.total_tokens,
					cost: props.usage.cost,
				}
			: undefined,
	);
</script>
<template>
	<div v-if="shown" class="pg-metrics response-metrics">
		<UiTooltip v-if="timeToFirstToken !== undefined" title="Time to first token"
			><span
				><UiIcon name="ClockCircleOutlined" /><span>TTFT: {{ (timeToFirstToken / 1000).toFixed(2) }}s</span></span
			></UiTooltip
		>
		<UiTooltip v-if="totalLatency !== undefined" title="Total latency"
			><span
				><UiIcon name="ClockCircleOutlined" /><span>Total Latency: {{ (totalLatency / 1000).toFixed(2) }}s</span></span
			></UiTooltip
		>
		<UiTooltip v-if="usage?.promptTokens !== undefined" title="Prompt tokens"
			><span
				><UiIcon name="ImportOutlined" /><span>In: {{ usage.promptTokens }}</span></span
			></UiTooltip
		>
		<UiTooltip v-if="usage?.completionTokens !== undefined" title="Completion tokens"
			><span
				><UiIcon name="ExportOutlined" /><span>Out: {{ usage.completionTokens }}</span></span
			></UiTooltip
		>
		<UiTooltip v-if="usage?.reasoningTokens !== undefined" title="Reasoning tokens"
			><span
				><UiIcon name="BulbOutlined" /><span>Reasoning: {{ usage.reasoningTokens }}</span></span
			></UiTooltip
		>
		<UiTooltip v-if="usage?.totalTokens !== undefined" title="Total tokens"
			><span
				><UiIcon name="NumberOutlined" /><span>Total: {{ usage.totalTokens }}</span></span
			></UiTooltip
		>
		<UiTooltip v-if="usage?.cost !== undefined" title="Cost"
			><span
				><UiIcon name="DollarOutlined" /><span>{{ money(usage.cost, 6, model) }}</span></span
			></UiTooltip
		>
	</div>
</template>
<style>
.pg-metrics {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	margin-top: 8px;
	padding-top: 8px;
	border-top: 1px solid #f3f4f6;
	font-size: 12px;
	line-height: 16px;
	color: #6b7280;
}
.pg-metrics > .ui-popover-anchor > span {
	display: flex;
	align-items: center;
	gap: 4px;
}
.pg-metrics .ui-icon {
	font-size: 12px;
}
</style>
