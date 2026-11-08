<script setup lang="ts">
import { computed } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import type { UsageMetadata } from "../support/UsageModels";
const props = defineProps<{
	metadata: UsageMetadata;
	totalSpend: number;
	maxBudget: number | null;
	dateRangeLabel: string;
	showTokenBreakdown: boolean;
}>();
const emit = defineEmits<{ toggle: [] }>();
const money = useMoneyFormatter(),
	number = (v: number) => formatNumberWithCommas(v, 0, false);
const tiles = computed(() => [
	{ label: "Total Spend", value: money(props.totalSpend, 4) },
	{ label: "Max Budget", value: props.maxBudget === null ? "No limit" : money(props.maxBudget, 4) },
	{ label: "Total Requests", value: props.metadata.total_api_requests.toLocaleString() },
	{
		label: "Successful Requests",
		value: props.metadata.total_successful_requests.toLocaleString(),
		color: "#059669",
		tooltip:
			formatNumberWithCommas(
				props.metadata.total_api_requests > 0
					? (props.metadata.total_successful_requests / props.metadata.total_api_requests) * 100
					: 0,
				1,
			) + "% success rate",
	},
	{
		label: "Failed Requests",
		value: props.metadata.total_failed_requests.toLocaleString(),
		color: "#e11d48",
		tooltip: "Includes routing, tool usage, and other request failures where a provider may not be available.",
	},
	{ label: "Avg. Cost / Request", value: money(props.totalSpend / (props.metadata.total_api_requests || 1), 4) },
]);
const tokens = computed(() => [
	{ label: "Input Tokens", value: number(props.metadata.total_prompt_tokens), color: "#2563eb" },
	{ label: "Output Tokens", value: number(props.metadata.total_completion_tokens), color: "#0891b2" },
	{ label: "Cache Read", value: number(props.metadata.total_cache_read_input_tokens), color: "#059669" },
	{ label: "Cache Write", value: number(props.metadata.total_cache_creation_input_tokens), color: "#7c3aed" },
]);
</script>
<template>
	<UiCard appearance="tremor" class="usage-metrics"
		><header>
			<h2>Usage Metrics</h2>
			<p>{{ dateRangeLabel }}</p>
		</header>
		<div class="usage-metrics-grid">
			<div v-for="tile in tiles" :key="tile.label" class="usage-metric">
				<label
					>{{ tile.label
					}}<UiTooltip v-if="tile.tooltip" :title="tile.tooltip"><UiIcon name="InfoCircleOutlined" :size="11" /></UiTooltip
				></label>
				<div :style="{ color: tile.color }" :title="tile.value">{{ tile.value }}</div>
			</div>
			<button type="button" class="usage-metric usage-token-toggle" :aria-expanded="showTokenBreakdown" @click="emit('toggle')">
				<label>Total Tokens<UiIcon :name="showTokenBreakdown ? 'DownOutlined' : 'RightOutlined'" :size="10" /></label>
				<div>{{ number(metadata.total_tokens) }}</div>
			</button>
		</div>
		<div v-if="showTokenBreakdown" class="usage-token-breakdown">
			<div v-for="tile in tokens" :key="tile.label" class="usage-metric">
				<label>{{ tile.label }}</label>
				<div :style="{ color: tile.color }" :title="tile.value">{{ tile.value }}</div>
			</div>
		</div>
	</UiCard>
</template>
