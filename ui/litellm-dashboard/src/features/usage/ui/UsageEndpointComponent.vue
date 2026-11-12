<script setup lang="ts">
import { computed } from "vue";
import UiTable from "../../platform/ui/UiTable.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UsageChart from "./charts/UsageChartComponent.vue";
import UsageLegend from "./charts/UsageLegendComponent.vue";
import UsageTokensCell from "./UsageTokensCellComponent.vue";
import { emptyMetrics, addMetrics } from "../logic/UsageSummaryLogic";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import type { DailyActivityResponse, SpendMetrics } from "../support/UsageModels";
const props = defineProps<{ data: DailyActivityResponse }>();
const money = useMoneyFormatter(),
	colors = ["blue", "cyan", "indigo", "violet", "purple", "fuchsia", "pink", "rose", "red", "orange"];
const rows = computed(() => {
	const map = new Map<string, SpendMetrics>();
	for (const day of props.data.results)
		for (const [endpoint, value] of Object.entries(day.breakdown.endpoints)) {
			const m = map.get(endpoint) ?? emptyMetrics();
			addMetrics(m, value.metrics);
			map.set(endpoint, m);
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
	const names = new Set<string>();
	for (const day of props.data.results) for (const key of Object.keys(day.breakdown.endpoints)) names.add(key);
	return props.data.results
		.map((day) => ({
			date: new Date(day.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
			...Object.fromEntries([...names].map((name) => [name, day.breakdown.endpoints[name]?.metrics.api_requests || 0])),
		}))
		.reverse();
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
		<UiTable :columns="columns" :rows="rows" row-key="endpoint"
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
				:height="320"
				:y-axis-width="60"
				legend
				:format="(v) => v.toLocaleString()"
		/></UiCard>
	</div>
</template>
