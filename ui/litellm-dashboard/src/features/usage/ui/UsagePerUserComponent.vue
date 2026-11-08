<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UsageChart from "./charts/UsageChartComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import { userAgentUsageApi, type PerUserReport } from "../api/UserAgentUsageApi";
import { abbreviated, usageDistribution } from "../logic/UserAgentUsageLogic";
const props = defineProps<{ tags: string[] }>();
const money = useMoneyFormatter(),
	tab = ref("details"),
	page = ref(1),
	data = ref<PerUserReport>({ results: [], total_count: 0, page: 1, page_size: 50, total_pages: 0 });
let generation = 0,
	controller: AbortController | null = null,
	disposed = false;
watch(
	() => [page.value, JSON.stringify(props.tags)],
	async () => {
		const current = ++generation;
		controller?.abort();
		const c = new AbortController();
		controller = c;
		try {
			const value = await userAgentUsageApi.users(page.value, props.tags, c.signal);
			if (!disposed && current === generation) data.value = value;
		} catch {
			/* Keep the last successful page available while retrying or changing filters. */
		}
	},
	{ immediate: true },
);
onBeforeUnmount(() => {
	disposed = true;
	generation++;
	controller?.abort();
});
const chart = computed(() => usageDistribution(data.value.results));
</script>
<template>
	<div class="usage-per-user">
		<h2>Per User Usage</h2>
		<p class="usage-subtitle">Individual developer usage metrics</p>
		<UiTabs
			v-model="tab"
			:items="[
				{ key: 'details', label: 'User Details' },
				{ key: 'distribution', label: 'Usage Distribution' },
			]"
			appearance="tremor"
		/>
		<div v-show="tab === 'details'">
			<div class="usage-per-user-table">
				<table class="usage-simple-table">
					<thead>
						<tr>
							<th>User ID</th>
							<th>User Email</th>
							<th>User Agent</th>
							<th>Success Generations</th>
							<th>Total Tokens</th>
							<th>Failed Requests</th>
							<th>Total Cost</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="(row, i) in data.results.slice(0, 10)" :key="i">
							<td>{{ row.user_id }}</td>
							<td>{{ row.user_email || "N/A" }}</td>
							<td>{{ row.user_agent || "Unknown" }}</td>
							<td>{{ abbreviated(row.successful_requests) }}</td>
							<td>{{ formatNumberWithCommas(row.total_tokens, 0, false) }}</td>
							<td>{{ abbreviated(row.failed_requests) }}</td>
							<td>{{ money(row.spend, 4) }}</td>
						</tr>
					</tbody>
				</table>
			</div>
			<div v-if="data.results.length > 10" class="usage-per-user-pagination">
				<span>Showing 10 of {{ data.total_count }} results</span>
				<div>
					<UiButton appearance="tremor" size="small" :disabled="page === 1" @click="page--">Previous</UiButton
					><UiButton appearance="tremor" size="small" :disabled="page >= data.total_pages" @click="page++">Next</UiButton>
				</div>
			</div>
		</div>
		<div v-show="tab === 'distribution'">
			<div>
				<h2>User Usage Distribution</h2>
				<p class="usage-subtitle">Number of users by successful request frequency</p>
			</div>
			<UsageChart
				:data="chart.data"
				index="category"
				:categories="chart.categories"
				:colors="['blue', 'green', 'orange', 'red', 'purple', 'yellow', 'pink', 'indigo']"
				:format="(v) => v + ' users'"
				:y-axis-width="80"
				stack
				legend
			/>
		</div>
	</div>
</template>
