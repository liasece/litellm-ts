<script setup lang="ts">
import "../styles/UsageTablesStyles.css";
import { computed, ref } from "vue";
import UiTable from "../../platform/ui/UiTable.vue";
import type { UiTableColumn, UiTableRow } from "../../platform/ui/UiTypes";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import UsageChart from "./charts/UsageChartComponent.vue";
import type { ModelRanking } from "../support/UsageModels";
const props = defineProps<{ rows: ModelRanking[] }>();
const limit = ref(5),
	mode = ref("table"),
	money = useMoneyFormatter(),
	visible = computed(() => props.rows.slice(0, limit.value));
const tableRows = computed<readonly UiTableRow[]>(() => visible.value as unknown as readonly UiTableRow[]);
const columns: readonly UiTableColumn[] = [
	{ key: "key", label: "Model", width: 280 },
	{ key: "spend", label: "Spend", width: 160 },
	{ key: "successful_requests", label: "Successful", width: 130, cellClass: "usage-success" },
	{ key: "failed_requests", label: "Failed", width: 100, cellClass: "usage-failed" },
	{ key: "tokens", label: "Tokens", width: 140 },
];
function modelRow(row: UiTableRow): ModelRanking {
	return row as unknown as ModelRanking;
}
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
	<UiTable v-if="mode === 'table'" :columns="columns" :rows="tableRows" row-key="key" fixed-layout empty-text="No logs found">
		<template #cell-key="{ row }">{{ modelRow(row).key || "-" }}</template>
		<template #cell-spend="{ row }">{{ money(modelRow(row).spend, 2, modelRow(row).key) }}</template>
		<template #cell-successful_requests="{ row }">{{ modelRow(row).successful_requests.toLocaleString() }}</template>
		<template #cell-failed_requests="{ row }">{{ modelRow(row).failed_requests.toLocaleString() }}</template>
		<template #cell-tokens="{ row }">{{ formatNumberWithCommas(modelRow(row).tokens, 0, false) }}</template>
	</UiTable>
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
