<script setup lang="ts">
import { computed } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UsageChart from "./charts/UsageChartComponent.vue";
import UsageLegend from "./charts/UsageLegendComponent.vue";
import UsageKeyModel from "./UsageKeyModelComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import type { ModelActivityData } from "../support/UsageModels";
const props = defineProps<{ metrics: ModelActivityData; hidePromptCachingMetrics?: boolean }>();
const money = useMoneyFormatter(),
	number = (n: number) => formatNumberWithCommas(n, 0, false);
const keyLabels = computed(() => {
	const labels = props.metrics.top_api_keys.map((k) => {
		const label = k.key_alias || k.key_name || k.api_key.slice(0, 10) + "...";
		return k.team_id ? label + " (team_id: " + k.team_id + ")" : label;
	});
	const counts = new Map<string, number>();
	for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
	return labels.map((label, i) =>
		counts.get(label)! > 1 ? label + " (" + props.metrics.top_api_keys[i].api_key.slice(0, 8) + ")" : label,
	);
});
const keys = computed(() => props.metrics.top_api_keys.map((k, i) => ({ ...k, key: keyLabels.value[i] })));
const bySpend = computed(() => [...keys.value].sort((a, b) => b.spend - a.spend)),
	byTokens = computed(() => [...keys.value].sort((a, b) => b.tokens - a.tokens));

const charts = computed(() => [
	{
		title: "Total Tokens",
		kind: "area" as const,
		categories: ["metrics.prompt_tokens", "metrics.completion_tokens", "metrics.total_tokens"],
		colors: ["blue", "cyan", "indigo"],
		format: number,
	},
	{
		title: "Requests per day",
		kind: "bar" as const,
		categories: ["metrics.api_requests"],
		colors: ["blue"],
		format: (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1000 ? v / 1000 + "k" : String(v)),
	},
	{
		title: "Success vs Failed Requests",
		kind: "area" as const,
		categories: ["metrics.successful_requests", "metrics.failed_requests"],
		colors: ["green", "red"],
		format: (v: number) => v.toLocaleString(),
	},
	...(!props.hidePromptCachingMetrics
		? [
				{
					title: "Prompt Caching Metrics",
					kind: "area" as const,
					categories: ["metrics.cache_read_input_tokens", "metrics.cache_creation_input_tokens"],
					colors: ["cyan", "purple"],
					format: number,
				},
			]
		: []),
]);
</script>
<template>
	<div class="usage-model-section">
		<div class="usage-grid-four">
			<UiCard appearance="tremor"
				><p>Total Requests</p>
				<h2>{{ metrics.total_requests.toLocaleString() }}</h2></UiCard
			><UiCard appearance="tremor"
				><p>Total Successful Requests</p>
				<h2>{{ metrics.total_successful_requests.toLocaleString() }}</h2></UiCard
			><UiCard appearance="tremor"
				><p>Total Tokens</p>
				<h2>{{ number(metrics.total_tokens) }}</h2>
				<p>{{ number(Math.round(metrics.total_tokens / metrics.total_successful_requests)) }} avg per successful request</p></UiCard
			><UiCard appearance="tremor"
				><p>Total Spend</p>
				<h2>{{ money(metrics.total_spend, 2) }}</h2>
				<p>{{ money(metrics.total_spend / metrics.total_successful_requests, 3) }} per successful request</p></UiCard
			>
		</div>
		<div v-if="keys.length" class="usage-activity-key-charts">
			<UiCard v-for="kind in ['spend', 'tokens']" :key="kind" appearance="tremor"
				><h2>Top Virtual Keys by {{ kind === "spend" ? "Spend" : "Tokens" }}</h2>
				<div>
					<UsageChart
						:data="kind === 'spend' ? bySpend : byTokens"
						index="key"
						:categories="[kind]"
						:colors="[kind === 'spend' ? 'cyan' : 'indigo']"
						horizontal
						:height="keys.length * 40 + 34"
						:y-axis-width="180"
						:format="kind === 'spend' ? (v) => money(v, 2) : number"
					/></div
			></UiCard>
		</div>
		<UsageKeyModel :models="metrics.top_models" />
		<UiCard appearance="tremor" class="usage-activity-daily"
			><header>
				<h2>Spend per day</h2>
				<UsageLegend :categories="['metrics.spend']" :colors="['green']" />
			</header>
			<UsageChart
				:data="metrics.daily_data"
				index="date"
				:categories="['metrics.spend']"
				:colors="['green']"
				:y-axis-width="72"
				:format="(v) => money(v, 2)"
		/></UiCard>
		<div class="usage-grid-two">
			<UiCard v-for="chart in charts" :key="chart.title" appearance="tremor"
				><header>
					<h2>{{ chart.title }}</h2>
					<UsageLegend :categories="chart.categories" :colors="chart.colors" />
				</header>
				<div v-if="chart.title === 'Prompt Caching Metrics'" class="usage-cache-totals">
					<p>Cache Read: {{ number(metrics.total_cache_read_input_tokens) }} tokens</p>
					<p>Cache Creation: {{ number(metrics.total_cache_creation_input_tokens) }} tokens</p>
				</div>
				<UsageChart
					:data="metrics.daily_data"
					index="date"
					:categories="chart.categories"
					:colors="chart.colors"
					:kind="chart.kind"
					:format="chart.format"
			/></UiCard>
		</div>
	</div>
</template>
