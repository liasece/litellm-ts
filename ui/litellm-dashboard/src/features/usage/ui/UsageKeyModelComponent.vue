<script setup lang="ts">
import "../styles/UsageTablesStyles.css";
import { computed, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import type { UiTableColumn, UiTableRow } from "../../platform/ui/UiTypes";
import UsageChart from "./charts/UsageChartComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import type { TopModelData } from "../support/UsageModels";
const props = defineProps<{ models: TopModelData[] }>();
const mode = ref("chart"),
	money = useMoneyFormatter(),
	number = (v: number) => formatNumberWithCommas(v, 0, false);
const bySpend = computed(() => [...props.models].sort((a, b) => b.spend - a.spend)),
	byTokens = computed(() => [...props.models].sort((a, b) => b.tokens - a.tokens)),
	columns: readonly UiTableColumn[] = [
		{ key: "model", label: "Model", width: 220 },
		{ key: "spend", label: "Spend", width: 120 },
		{ key: "requests", label: "Requests", width: 120 },
		{ key: "successful_requests", label: "Successful", width: 120, cellClass: "usage-success" },
		{ key: "failed_requests", label: "Failed", width: 100, cellClass: "usage-failed" },
		{ key: "tokens", label: "Tokens", width: 140 },
	],
	tableRows = computed<readonly UiTableRow[]>(() => bySpend.value as unknown as readonly UiTableRow[]);
function modelRow(row: UiTableRow): TopModelData {
	return row as unknown as TopModelData;
}
</script>
<template>
	<UiCard v-if="models.length" appearance="tremor" class="usage-key-model"
		><header>
			<h2>Model Usage</h2>
			<div class="usage-view-buttons">
				<button :class="{ active: mode === 'table' }" @click="mode = 'table'">Table</button
				><button :class="{ active: mode === 'chart' }" @click="mode = 'chart'">Chart</button>
			</div>
		</header>
		<div v-if="mode === 'chart'" class="usage-activity-key-charts">
			<div v-for="kind in ['spend', 'tokens']" :key="kind">
				<h2>Top Models by {{ kind === "spend" ? "Spend" : "Tokens" }}</h2>
				<div>
					<UsageChart
						:data="(kind === 'spend' ? bySpend : byTokens).map((row) => ({ ...row, key: row.model }))"
						index="key"
						:categories="[kind]"
						:colors="[kind === 'spend' ? 'cyan' : 'indigo']"
						horizontal
						:height="models.length * 40 + 34"
						:y-axis-width="180"
						:format="kind === 'spend' ? (v) => money(v, 2) : number"
					/>
				</div>
			</div>
		</div>
		<UiTable
			v-else
			:columns="columns"
			:rows="tableRows"
			row-key="model"
			fixed-layout
			sticky-header
			:body-max-height="models.length > 5 ? 202 : undefined"
			empty-text="No logs found"
		>
			<template #cell-model="{ row }">{{ modelRow(row).model || "-" }}</template>
			<template #cell-spend="{ row }">{{ money(modelRow(row).spend, 2, modelRow(row).model) }}</template>
			<template #cell-requests="{ row }">{{ modelRow(row).requests?.toLocaleString() || 0 }}</template>
			<template #cell-successful_requests="{ row }">{{ modelRow(row).successful_requests?.toLocaleString() || 0 }}</template>
			<template #cell-failed_requests="{ row }">{{ modelRow(row).failed_requests?.toLocaleString() || 0 }}</template>
			<template #cell-tokens="{ row }">{{ number(modelRow(row).tokens ?? 0) }}</template>
		</UiTable></UiCard
	>
</template>
