<script setup lang="ts">
import { computed } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import TremorDateRangePicker from "../../date-range/ui/TremorDateRangePickerComponent.vue";
import type { DateRangeValue } from "../../date-range/support/DateRangeModels";
import CacheBarChart from "./CacheBarChartComponent.vue";
import { cacheMetrics, compactCacheNumber } from "../logic/CacheMetricsLogic";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
const props = defineProps<{ rows: Record<string, unknown>[] }>();
const keys = defineModel<string[]>("keys", { required: true }),
	models = defineModel<string[]>("models", { required: true }),
	range = defineModel<DateRangeValue>("range", { required: true });
const metric = computed(() => cacheMetrics(props.rows, keys.value, models.value));
const keyOptions = computed(() =>
	[...new Set(props.rows.map((row) => String(row.api_key ?? "")))].map((value) => ({ value, label: value })),
);
const modelOptions = computed(() =>
	[...new Set(props.rows.map((row) => String(row.model ?? "")))].map((value) => ({ value, label: value })),
);
</script>
<template>
	<UiCard appearance="tremor" class="cache-analytics"
		><div class="cache-analytics-filters">
			<UiSelect
				v-model="keys"
				:options="keyOptions"
				appearance="tremor"
				multiple
				searchable
				placeholder="Select Virtual Keys"
				aria-label="Select Virtual Keys"
			/><UiSelect
				v-model="models"
				:options="modelOptions"
				appearance="tremor"
				multiple
				searchable
				placeholder="Select Models"
				aria-label="Select Models"
			/><TremorDateRangePicker v-model="range" />
		</div>
		<div class="cache-statistics">
			<UiCard appearance="tremor"
				><p>Cache Hit Ratio</p>
				<strong>{{ metric.ratio }}%</strong></UiCard
			><UiCard appearance="tremor"
				><p>Cache Hits</p>
				<strong>{{ compactCacheNumber(metric.hits) }}</strong></UiCard
			><UiCard appearance="tremor"
				><p>Cached Tokens</p>
				<strong>{{ formatNumberWithCommas(metric.tokens, 0, false) }}</strong></UiCard
			>
		</div>
		<h3>Cache Hits vs API Requests</h3>
		<CacheBarChart :data="metric.chart" :categories="['LLM API requests', 'Cache hit']" />
		<h3>Cached Completion Tokens vs Generated Completion Tokens</h3>
		<CacheBarChart
			:data="metric.chart"
			:categories="['Generated Completion Tokens', 'Cached Completion Tokens']"
			tokens
			class="cache-token-chart"
	/></UiCard>
</template>
