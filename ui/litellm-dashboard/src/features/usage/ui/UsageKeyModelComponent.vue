<script setup lang="ts">
import "../styles/UsageTablesStyles.css";
import { computed, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UsageChart from "./charts/UsageChartComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import type { TopModelData } from "../support/UsageModels";
const props = defineProps<{ models: TopModelData[] }>();
const mode = ref("chart"),
	money = useMoneyFormatter(),
	number = (v: number) => formatNumberWithCommas(v, 0, false);
const bySpend = computed(() => [...props.models].sort((a, b) => b.spend - a.spend)),
	byTokens = computed(() => [...props.models].sort((a, b) => b.tokens - a.tokens));
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
		<div v-else class="usage-antd-small-table" :style="{ maxHeight: models.length > 5 ? '234px' : undefined }">
			<table>
				<thead>
					<tr>
						<th>Model</th>
						<th>Spend</th>
						<th>Requests</th>
						<th>Successful</th>
						<th>Failed</th>
						<th>Tokens</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="row in bySpend" :key="row.model">
						<td>{{ row.model || "-" }}</td>
						<td>{{ money(row.spend, 2, row.model) }}</td>
						<td>{{ row.requests?.toLocaleString() || 0 }}</td>
						<td class="usage-success">{{ row.successful_requests?.toLocaleString() || 0 }}</td>
						<td class="usage-failed">{{ row.failed_requests?.toLocaleString() || 0 }}</td>
						<td>{{ number(row.tokens ?? 0) }}</td>
					</tr>
				</tbody>
			</table>
		</div></UiCard
	>
</template>
