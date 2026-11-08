<script setup lang="ts">
import UiCard from "../../../platform/ui/UiCard.vue";
import UsageChartComponent from "../../../usage/ui/charts/UsageChartComponent.vue";
defineProps<{ data?: { date: string; passed: number; blocked: number }[] }>();
</script>
<template>
	<UiCard class="monitor-score-chart"
		><h2>Request Outcomes Over Time</h2>
		<div>
			<UsageChartComponent
				v-if="data?.length"
				:data="data"
				index="date"
				:categories="['passed', 'blocked']"
				:colors="['green', 'red']"
				:height="320"
				:y-axis-width="48"
				legend
				stack
			/>
			<div v-else class="monitor-score-empty">No chart data for this period</div>
		</div></UiCard
	>
</template>
