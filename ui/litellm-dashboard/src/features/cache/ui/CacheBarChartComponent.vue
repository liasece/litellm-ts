<script setup lang="ts">
import { computed } from "vue";
import UsageChart from "../../usage/ui/charts/UsageChartComponent.vue";
import { compactCacheNumber, type CacheChartRow } from "../logic/CacheMetricsLogic";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
const props = defineProps<{ data: CacheChartRow[]; categories: (keyof Omit<CacheChartRow, "name">)[]; tokens?: boolean }>();
const rows = computed(() => props.data.map((row) => ({ ...row })));
const format = (value: number) => (props.tokens ? formatNumberWithCommas(value, 0, false) : compactCacheNumber(value));
</script>
<template>
	<UsageChart
		class="cache-chart"
		:data="rows"
		index="name"
		:categories="categories"
		:colors="['#0ea5e9', '#14b8a6']"
		kind="bar"
		:height="320"
		:y-axis-width="48"
		legend
		stack
		:format="format"
	/>
</template>
