<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UsageChart from "./charts/UsageChartComponent.vue";
import UsageChartLoader from "./UsageChartLoaderComponent.vue";
import UsagePerUser from "./UsagePerUserComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import { createUserAgentUsageStore } from "../stores/UserAgentUsageStore";
import { extractUserAgent, abbreviated, activeUserChart } from "../logic/UserAgentUsageLogic";
import type { DateRangeValue } from "../../date-range/support/DateRangeModels";
const props = defineProps<{ dateRange: DateRangeValue }>(),
	store = createUserAgentUsageStore(),
	{ state } = store;
const tags = ref<string[]>([]),
	tab = ref("active"),
	period = ref("dau"),
	money = useMoneyFormatter(),
	today = new Date();
void store.loadTags();
let activityTimer: ReturnType<typeof setTimeout> | null = null,
	summaryTimer: ReturnType<typeof setTimeout> | null = null;
watch(
	() => JSON.stringify(tags.value),
	() => {
		if (activityTimer) clearTimeout(activityTimer);
		activityTimer = setTimeout(() => void store.loadActivity(tags.value, today), 50);
	},
	{ immediate: true },
);
watch(
	() => [props.dateRange.from?.getTime(), props.dateRange.to?.getTime(), JSON.stringify(tags.value)],
	() => {
		if (summaryTimer) clearTimeout(summaryTimer);
		const from = props.dateRange.from,
			to = props.dateRange.to;
		if (from && to) summaryTimer = setTimeout(() => void store.loadSummary(from, to, tags.value), 50);
	},
	{ immediate: true },
);
onBeforeUnmount(() => {
	if (activityTimer) clearTimeout(activityTimer);
	if (summaryTimer) clearTimeout(summaryTimer);
	store.dispose();
});
const summaries = computed(() => [
	...state.summary.slice(0, 4),
	...Array.from({ length: Math.max(0, 4 - state.summary.length) }, () => null),
]);
const charts = computed(() =>
	(["dau", "wau", "mau"] as const).map((key) => ({
		key,
		...activeUserChart(state[key], key),
		loading: state[(key + "Loading") as "dauLoading" | "wauLoading" | "mauLoading"],
	})),
);
const options = computed(() =>
	state.tags.map((value) => {
		const label = extractUserAgent(value);
		return { value, label: label.length > 50 ? label.slice(0, 50) + "..." : label };
	}),
);
function select(value: unknown) {
	tags.value = Array.isArray(value) ? value.map(String) : [];
}
</script>
<template>
	<div class="usage-user-agent">
		<UiCard appearance="tremor"
			><div class="usage-user-agent-summary">
				<header>
					<div>
						<h2>Summary by User Agent</h2>
						<p class="usage-subtitle">Performance metrics for different user agents</p>
					</div>
					<div>
						<label>Filter by User Agents</label
						><UiSelect
							:model-value="tags"
							:options="options"
							placeholder="All User Agents"
							max-tag-count="responsive"
							multiple
							searchable
							clearable
							:loading="state.tagsLoading"
							@update:model-value="select"
						/>
					</div>
				</header>
				<UsageChartLoader v-if="state.summaryLoading" />
				<div v-else class="usage-grid-four">
					<UiCard v-for="(summary, i) in summaries" :key="i" appearance="tremor"
						><UiTooltip v-if="summary" :title="extractUserAgent(summary.tag)"
							><h2>
								{{
									extractUserAgent(summary.tag).length > 15
										? extractUserAgent(summary.tag).slice(0, 15) + "..."
										: extractUserAgent(summary.tag)
								}}
							</h2></UiTooltip
						>
						<h2 v-else>No Data</h2>
						<div class="usage-user-agent-totals">
							<div>
								<p>Success Requests</p>
								<strong>{{ summary ? abbreviated(summary.successful_requests) : "-" }}</strong>
							</div>
							<div>
								<p>Total Tokens</p>
								<strong>{{ summary ? formatNumberWithCommas(summary.total_tokens, 0, false) : "-" }}</strong>
							</div>
							<div>
								<p>Total Cost</p>
								<strong>{{ summary ? money(summary.total_spend, 4) : "-" }}</strong>
							</div>
						</div></UiCard
					>
				</div>
			</div></UiCard
		>
		<UiCard appearance="tremor"
			><UiTabs
				v-model="tab"
				:items="[
					{ key: 'active', label: 'DAU/WAU/MAU' },
					{ key: 'users', label: 'Per User Usage (Last 30 Days)' },
				]"
				appearance="tremor"
				class="usage-agent-tabs" />
			<div v-show="tab === 'active'">
				<header class="usage-agent-chart-heading">
					<h2>DAU, WAU &amp; MAU per Agent</h2>
					<p class="usage-subtitle">Active users across different time periods</p>
				</header>
				<UiTabs
					v-model="period"
					:items="[
						{ key: 'dau', label: 'DAU' },
						{ key: 'wau', label: 'WAU' },
						{ key: 'mau', label: 'MAU' },
					]"
					appearance="tremor"
					class="usage-agent-tabs"
				/>
				<div v-for="chart in charts" :key="chart.key" v-show="period === chart.key">
					<h2 class="usage-agent-chart-title">
						{{
							chart.key === "dau"
								? "Daily Active Users - Last 7 Days"
								: chart.key === "wau"
									? "Weekly Active Users - Last 7 Weeks"
									: "Monthly Active Users - Last 7 Months"
						}}
					</h2>
					<UsageChartLoader v-if="chart.loading" /><UsageChart
						v-else
						:data="chart.data"
						:index="chart.index"
						:categories="chart.categories"
						:colors="['blue', 'emerald', 'violet', 'amber', 'gray', 'cyan', 'pink', 'lime', 'fuchsia', 'rose']"
						:format="abbreviated"
						:y-axis-width="60"
						legend
						stack
					/>
				</div>
			</div>
			<UsagePerUser v-show="tab === 'users'" :tags="tags"
		/></UiCard>
	</div>
</template>
