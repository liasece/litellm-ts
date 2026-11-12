<script setup lang="ts">
import { computed } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import { usageTokenBreakdown } from "../logic/UsageTokenLogic";
import type { UsageMetadata } from "../support/UsageModels";
const props = defineProps<{
	metadata: UsageMetadata;
	totalSpend: number;
	maxBudget: number | null;
	dateRangeLabel: string;
}>();
const money = useMoneyFormatter(),
	number = (v: number) => formatNumberWithCommas(v, 0, false),
	percent = (v: number) => formatNumberWithCommas(v, 1) + "%";
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
const tokens = computed(() =>
	usageTokenBreakdown({
		prompt_tokens: props.metadata.total_prompt_tokens,
		completion_tokens: props.metadata.total_completion_tokens,
		total_tokens: props.metadata.total_tokens,
		cache_read_input_tokens: props.metadata.total_cache_read_input_tokens,
		cache_creation_input_tokens: props.metadata.total_cache_creation_input_tokens,
	}),
);
const tokenLines = computed(() => [
	{ key: "input", label: "Input", value: tokens.value.input, share: tokens.value.inputShare, color: "#2563eb" },
	{ key: "output", label: "Output", value: tokens.value.output, share: tokens.value.outputShare, color: "#0891b2" },
	{ key: "cache", label: "Cache read", value: tokens.value.cacheRead, share: tokens.value.cacheReadShare, color: "#059669" },
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
		</div>
		<section class="usage-token-panel" aria-label="Token usage">
			<div class="usage-token-summary">
				<div class="usage-token-total">
					<label>Total Tokens</label>
					<strong>{{ number(metadata.total_tokens) }}</strong>
				</div>
				<div class="usage-token-rate">
					<UiTooltip
						title="Cache reads divided by all input tokens. Cache writes are not counted as hits, and they stay part of input."
						><span class="usage-token-rate-value">{{ tokens.hitRate }}%</span></UiTooltip
					>
					<span class="usage-token-rate-label">cache hit rate</span>
					<span class="usage-token-rate-track" aria-hidden="true"
						><i :style="{ width: Math.min(Math.max(tokens.hitRate, 0), 100) + '%' }"
					/></span>
				</div>
			</div>
			<div class="usage-token-lines">
				<div v-for="line in tokenLines" :key="line.key" class="usage-token-line">
					<span class="usage-token-line-label"
						><i :style="{ backgroundColor: line.color }" aria-hidden="true" />{{ line.label }}</span
					>
					<b>{{ number(line.value) }}</b>
					<small>{{ percent(line.share) }}</small>
				</div>
			</div>
			<div class="usage-token-composition" aria-hidden="true">
				<i
					v-for="line in tokenLines"
					:key="line.key"
					:style="{ width: Math.max(line.share, 0) + '%', backgroundColor: line.color }"
				/>
			</div>
			<p v-if="tokens.cacheWrite > 0" class="usage-token-note">
				Cache write {{ number(tokens.cacheWrite) }} tokens (included in input, excluded from the hit rate).
			</p>
		</section>
	</UiCard>
</template>
