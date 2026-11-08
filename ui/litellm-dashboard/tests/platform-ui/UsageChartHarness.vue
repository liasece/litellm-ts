<script setup lang="ts">
import { ref } from "vue";
import UsageChart from "../../src/features/usage/ui/charts/UsageChartComponent.vue";
const visible = ref(true),
	selection = ref("");
const rankingLegend = new URLSearchParams(location.search).has("rankingLegend");
const daily = [
	{ date: "2026-11-05", spend: 2 },
	{ date: "2026-11-06", spend: 4 },
	{ date: "2026-11-07", spend: 6 },
];
const ranking = [
	{ name: "gpt-4.1", spend: 7.5 },
	{ name: "claude-sonnet-4", spend: 4.5 },
];
const area = [3000, 6000, 9000].map((value, index) => ({ date: "Day " + (index + 1), metrics: { total_tokens: value } }));
const format = (value: number) => "$" + value;
</script>
<template>
	<button @click="visible = !visible">Toggle charts</button><output data-testid="selection">{{ selection }}</output
	><template v-if="visible"
		><div class="daily">
			<UsageChart
				:data="daily"
				index="date"
				:categories="['spend']"
				:height="288"
				:y-axis-width="100"
				:format="format"
				@select="(row) => (selection = String(row.date))"
				><template #tooltip="{ row }"
					><span data-testid="chart-tooltip">{{ row.date }}</span></template
				></UsageChart
			>
		</div>
		<div class="ranking">
			<UsageChart
				:data="ranking"
				index="name"
				:categories="['spend']"
				:height="rankingLegend ? 200 : 80"
				:legend="rankingLegend"
				:y-axis-width="160"
				:format="format"
				horizontal
				ranking
				@select="(row) => (selection = String(row.name))"
				><template #annotation="{ row }"
					><span>{{ row.name === "gpt-4.1" ? "28.6%" : "0%" }}</span></template
				></UsageChart
			>
		</div>
		<div class="area">
			<UsageChart
				:data="area"
				index="date"
				:categories="['metrics.total_tokens']"
				:colors="['blue']"
				kind="area"
				:y-axis-width="56"
				:format="(value) => value.toLocaleString('en-US')"
				@select="(row) => (selection = String(row.date))"
			/>
		</div>
		<div class="legend">
			<UsageChart
				:data="daily"
				index="date"
				:categories="['spend']"
				:colors="['blue']"
				legend
				stack
				:height="320"
				:y-axis-width="60"
				:format="(value, places = 0) => value.toFixed(places)"
			/>
		</div>
	</template>
</template>
<style>
.area {
	width: 517px;
}
.legend {
	width: 1132px;
}
.daily {
	width: 651px;
}
.ranking {
	width: 453px;
}
</style>
