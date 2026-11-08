<script setup lang="ts">
import "../styles/UsageTablesStyles.css";
import { computed, ref } from "vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import UsageChart from "./charts/UsageChartComponent.vue";
import type { ModelRanking } from "../support/UsageModels";
const props = defineProps<{ rows: ModelRanking[] }>();
const limit = ref(5),
	mode = ref("table"),
	money = useMoneyFormatter(),
	visible = computed(() => props.rows.slice(0, limit.value));
</script>
<template>
	<div class="usage-model-table-toolbar">
		<div class="usage-segmented">
			<button v-for="n in [5, 10, 25, 50]" :key="n" :class="{ active: limit === n }" @click="limit = n">{{ n }}</button>
		</div>
		<div>
			<button :class="{ active: mode === 'table' }" @click="mode = 'table'">Table View</button
			><button :class="{ active: mode === 'chart' }" @click="mode = 'chart'">Chart View</button>
		</div>
	</div>
	<div v-if="mode === 'table'" class="usage-data-table usage-model-table">
		<table>
			<thead>
				<tr>
					<th>Model</th>
					<th>Spend</th>
					<th>Successful</th>
					<th>Failed</th>
					<th>Tokens</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="row in visible" :key="row.key">
					<td>{{ row.key || "-" }}</td>
					<td>{{ money(row.spend, 2, row.key) }}</td>
					<td class="usage-success">{{ row.successful_requests.toLocaleString() }}</td>
					<td class="usage-failed">{{ row.failed_requests.toLocaleString() }}</td>
					<td>{{ formatNumberWithCommas(row.tokens, 0, false) }}</td>
				</tr>
				<tr v-if="!visible.length">
					<td colspan="5" class="usage-no-logs">No logs found</td>
				</tr>
			</tbody>
		</table>
	</div>
	<div v-else class="usage-model-chart">
		<UsageChart
			:data="visible as unknown as Record<string, unknown>[]"
			index="key"
			:categories="['spend']"
			horizontal
			:height="visible.length * 52"
			:y-axis-width="200"
			:format="(v) => money(v, 2)"
		/>
	</div>
</template>
