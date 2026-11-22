<script setup lang="ts">
import { ref } from "vue";
import UsageChart from "../../src/features/usage/ui/charts/UsageChartComponent.vue";
import { NO_DATA_KEY } from "../../src/features/usage/logic/UsageEmptyDaysLogic";
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
// 命中率图：两条线，第二条中间那天没有请求（null），线要在那里断开。
const rate = [
	{ date: "2026-11-05", first: 80, second: 40 },
	{ date: "2026-11-06", first: 60, second: null },
	{ date: "2026-11-07", first: 90, second: 20 },
];
// 缺数据的一天：日期仍占一个槽位，由图表画灰带并写 No data，而不是被从横轴上略过。
const emptyDay = [
	{ date: "2026-11-05", tokens: 10 },
	{ date: "2026-11-06", [NO_DATA_KEY]: true },
	{ date: "2026-11-07", tokens: 30 },
];
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
		<div class="rate">
			<UsageChart
				:data="rate"
				index="date"
				:categories="['first', 'second']"
				:colors="['indigo', 'emerald']"
				kind="line"
				:legend="false"
				:height="280"
				:y-axis-width="48"
				:format="(value) => Math.round(value) + '%'"
			/>
		</div>
		<div class="empty-day">
			<UsageChart
				:data="emptyDay"
				index="date"
				:categories="['tokens']"
				:height="200"
				:y-axis-width="48"
				:format="(value) => value.toLocaleString('en-US')"
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
.empty-day {
	width: 651px;
}
.daily {
	width: 651px;
}
.ranking {
	width: 453px;
}
</style>
