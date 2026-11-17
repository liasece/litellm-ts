<script setup lang="ts">
import { computed } from "vue";
import UiTable from "../../platform/ui/UiTable.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UsageChart from "./charts/UsageChartComponent.vue";
import UsageLegend from "./charts/UsageLegendComponent.vue";
import UsageTokensCell from "./UsageTokensCellComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { addMetrics, emptyMetrics } from "../logic/UsageSummaryLogic";
import type { DailyActivityResponse, SpendMetrics, UsageDetailResponse } from "../support/UsageModels";
const props = defineProps<{ data?: DailyActivityResponse; detail?: UsageDetailResponse | null }>();
const money = useMoneyFormatter(),
	colors = ["blue", "cyan", "indigo", "violet", "purple", "fuchsia", "pink", "rose", "red", "orange"];
const rows = computed(() => {
	if (props.detail) {
		return props.detail.items.map((item) => ({
			endpoint: item.key,
			metrics: item.metrics,
			successRate: item.metrics.api_requests ? (item.metrics.successful_requests / item.metrics.api_requests) * 100 : 0,
		}));
	}
	const map = new Map<string, SpendMetrics>();
	for (const day of props.data?.results ?? [])
		for (const [endpoint, value] of Object.entries(day.breakdown.endpoints)) {
			const metrics = map.get(endpoint) ?? emptyMetrics();
			addMetrics(metrics, value.metrics);
			map.set(endpoint, metrics);
		}
	return [...map].map(([endpoint, metrics]) => ({
		endpoint,
		metrics,
		successRate: metrics.api_requests ? (metrics.successful_requests / metrics.api_requests) * 100 : 0,
	}));
});
const columns = [
	{ key: "endpoint", label: "Endpoint" },
	{ key: "requests", label: "Successful / Failed" },
	{ key: "api_requests", label: "Total Request" },
	{ key: "successRate", label: "Success Rate" },
	{
		key: "total_tokens",
		label: "Tokens",
		tooltip: "Cache read, input (excluding cache reads) and output tokens, plus the cache hit rate.",
	},
	{ key: "spend", label: "Spend" },
];
const trends = computed(() => {
	const byDate = new Map<string, Record<string, number>>();
	if (props.detail) {
		for (const item of props.detail.items)
			for (const day of item.daily) {
				const row = byDate.get(day.date) ?? {};
				row[item.key] = day.metrics.api_requests;
				byDate.set(day.date, row);
			}
	} else {
		for (const day of props.data?.results ?? [])
			for (const [endpoint, value] of Object.entries(day.breakdown.endpoints)) {
				const row = byDate.get(day.date) ?? {};
				row[endpoint] = value.metrics.api_requests;
				byDate.set(day.date, row);
			}
	}
	return [...byDate.entries()]
		.sort((left, right) => left[0].localeCompare(right[0]))
		.map(([date, values]) => ({
			date: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
			...values,
		}));
});
const categories = computed(() => Object.keys(trends.value[0] ?? {}).filter((k) => k !== "date"));
function metricsFor(row: Record<string, unknown>): SpendMetrics {
	return row.metrics as SpendMetrics;
}
function rateFor(row: Record<string, unknown>): number {
	return Number(row.successRate);
}
function successColor(rate: number) {
	return rate >= 95 ? "#16a34a" : rate >= 80 ? "#ca8a04" : "#dc2626";
}
</script>
<template>
	<div class="usage-endpoints">
		<UiTable :columns="columns" :rows="rows" row-key="endpoint" mobile-cards
			><template #cell-endpoint="{ row }"
				><span class="usage-endpoint-name">{{ row.endpoint }}</span></template
			><template #cell-requests="{ row }"
				><div class="usage-endpoint-progress">
					<div>
						<i
							:style="{
								width:
									(metricsFor(row).api_requests
										? ((metricsFor(row).successful_requests + metricsFor(row).failed_requests) /
												metricsFor(row).api_requests) *
											100
										: 0) + '%',
								background: 'linear-gradient(to right,#22c55e ' + rateFor(row) + '%,#ef4444 ' + rateFor(row) + '%)',
							}"
						/>
					</div>
					<div class="usage-endpoint-counts">
						<span class="usage-success">{{ metricsFor(row).successful_requests.toLocaleString() }}</span
						><span>/</span><span class="usage-failed">{{ metricsFor(row).failed_requests.toLocaleString() }}</span>
					</div>
				</div></template
			><template #cell-api_requests="{ row }">{{ metricsFor(row).api_requests.toLocaleString() }}</template
			><template #cell-successRate="{ row }"
				><span class="usage-endpoint-rate" :style="{ color: successColor(rateFor(row)) }"
					>{{ rateFor(row).toFixed(2) }}%</span
				></template
			><template #cell-total_tokens="{ row }"><UsageTokensCell :metrics="metricsFor(row)" /></template
			><template #cell-spend="{ row }">{{ money(metricsFor(row).spend, 2) }}</template></UiTable
		>
		<UiCard appearance="tremor"
			><header>
				<h2>Success vs Failed Requests by Endpoint</h2>
				<UsageLegend :categories="['metrics.successful_requests', 'metrics.failed_requests']" :colors="['green', 'red']" />
			</header>
			<UsageChart
				:data="rows"
				index="endpoint"
				:categories="['metrics.successful_requests', 'metrics.failed_requests']"
				:colors="['green', 'red']"
				stack
				:height="220"
				:y-axis-width="60"
				:format="(v) => v.toLocaleString()"
		/></UiCard>
		<UiCard appearance="tremor"
			><h2>Endpoint Usage Trends</h2>
			<UsageChart
				:data="trends"
				index="date"
				:categories="categories"
				:colors="colors.slice(0, categories.length)"
				kind="line"
				curve="natural"
				connect-nulls
				:height="240"
				:y-axis-width="60"
				legend
				:format="(v) => v.toLocaleString()"
		/></UiCard>
	</div>
</template>
