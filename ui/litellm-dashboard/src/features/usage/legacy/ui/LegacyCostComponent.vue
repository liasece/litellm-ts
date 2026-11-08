<script setup lang="ts">
import UiCard from "../../../platform/ui/UiCard.vue";
import UsageTopKeys from "../../ui/UsageTopKeysComponent.vue";
import UsageChart from "../../ui/charts/UsageChartComponent.vue";
import LegacyProviderPie from "./LegacyProviderPieComponent.vue";
import { useMoneyFormatter } from "../../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../../formatting/logic/NumberFormattingLogic";
import type { createLegacyUsageStore } from "../stores/LegacyUsageStore";
defineProps<{ data: ReturnType<typeof createLegacyUsageStore>["state"] }>();
const money = useMoneyFormatter();
const month = new Date().toLocaleString("default", { month: "long" }),
	last = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
const monthlyAxis = (value: number) => "$ " + formatNumberWithCommas(value, 2);
</script>
<template>
	<div class="legacy-cost-grid">
		<div class="legacy-span2">
			<p class="legacy-project-period">Project Spend {{ month }} 1 - {{ last }}</p>
			<div class="legacy-spend-metrics">
				<div>
					<p>Total Spend</p>
					<strong>{{ money(data.monthlySpend, 4) }}</strong>
				</div>
				<div>
					<p>Max Budget</p>
					<strong>No limit</strong>
				</div>
			</div>
		</div>
		<UiCard appearance="tremor" class="legacy-span2"
			><h3>Monthly Spend</h3>
			<UsageChart
				:data="data.spend"
				index="date"
				:categories="['spend']"
				:colors="['cyan']"
				:format="monthlyAxis"
				:y-axis-width="100"
				legend
				:legend-height="42" /></UiCard
		><UiCard appearance="tremor" class="legacy-full-height"
			><h3>Top Virtual Keys</h3>
			<UsageTopKeys :rows="data.topKeys" /></UiCard
		><UiCard appearance="tremor" class="legacy-full-height legacy-top-models"
			><h3>Top Models</h3>
			<UsageChart
				:data="data.topModels"
				index="key"
				:categories="['spend']"
				:colors="['cyan']"
				horizontal
				:height="160"
				:y-axis-width="200"
				:legend="false"
				:show-x-axis="false"
				:format="(value) => money(value, 2)"
		/></UiCard>
		<div />
		<UiCard appearance="tremor" class="legacy-span2 legacy-providers"
			><h3>Spend by Provider</h3>
			<div class="legacy-two-columns">
				<LegacyProviderPie :data="data.providers" />
				<div class="legacy-table-scroll">
					<table class="legacy-table">
						<thead>
							<tr>
								<th>Provider</th>
								<th>Spend</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="(row, index) in data.providers" :key="index">
								<td>{{ row.provider }}</td>
								<td>{{ money(Number(row.spend), 2) }}</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div></UiCard
		>
	</div>
</template>
