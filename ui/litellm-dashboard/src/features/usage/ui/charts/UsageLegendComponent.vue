<script setup lang="ts">
import "../../styles/UsageChartsStyles.css";
import { usageColors } from "../../logic/UsageChartLogic";
defineProps<{ categories: string[]; colors: string[]; dashed?: boolean[] }>();
function label(value: string) {
	return value
		.replace("metrics.", "")
		.replace(/_/g, " ")
		.split(" ")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}
</script>
<template>
	<div class="usage-chart-legend">
		<span v-for="(category, i) in categories" :key="category"
			><i
				:class="{ 'usage-chart-legend-dash': dashed?.[i] }"
				:style="{
					color: colors[i] === 'purple' ? '#8b5cf6' : colors[i] === 'emerald' ? '#37bc7d' : (usageColors[colors[i]] ?? colors[i]),
					backgroundColor: dashed?.[i]
						? undefined
						: colors[i] === 'purple'
							? '#8b5cf6'
							: colors[i] === 'emerald'
								? '#37bc7d'
								: (usageColors[colors[i]] ?? colors[i]),
				}"
			/>{{ label(category) }}</span
		>
	</div>
</template>
