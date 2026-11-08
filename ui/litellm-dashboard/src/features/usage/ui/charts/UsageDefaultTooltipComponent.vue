<script setup lang="ts">
import { chartValue, type ChartRow } from "../../logic/UsageChartLogic";
defineProps<{
	row: ChartRow;
	index: string;
	categories: string[];
	colors: string[];
	format: (value: number) => string;
	compact: boolean;
}>();
function label(value: string) {
	return value
		.replace("metrics.", "")
		.replace(/_/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}
</script>
<template>
	<div class="usage-default-tooltip" :class="{ 'usage-default-tooltip--compact': compact }">
		<p class="usage-default-tooltip-label">{{ chartValue(row, index) }}</p>
		<div class="usage-default-tooltip-rows">
			<div v-for="(category, i) in categories" :key="category">
				<div>
					<i :style="{ backgroundColor: colors[i % colors.length] }" />
					<p>{{ compact ? label(category) : category }}</p>
				</div>
				<p>{{ format(Number(chartValue(row, category))) }}</p>
			</div>
		</div>
	</div>
</template>
<style>
.usage-default-tooltip {
	font-size: 12.4px;
	line-height: 18.4px;
}
.usage-default-tooltip-label {
	padding: 8px 16px;
	border-bottom: 1px solid #e5e7eb;
	font-weight: 500;
	color: #374151;
}
.usage-default-tooltip-rows {
	padding: 8px 16px;
	display: flex;
	flex-direction: column;
	gap: 4px;
}
.usage-default-tooltip-rows > div {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 32px;
}
.usage-default-tooltip-rows > div > div {
	display: flex;
	align-items: center;
	gap: 8px;
}
.usage-default-tooltip-rows i {
	width: 12px;
	height: 12px;
	flex: none;
	border: 2px solid #fff;
	border-radius: 9999px;
	box-shadow:
		0 1px 3px #0000001a,
		0 1px 2px -1px #0000001a;
}
.usage-default-tooltip-rows p {
	white-space: nowrap;
	color: #6b7280;
}
.usage-default-tooltip-rows > div > p {
	font-weight: 500;
	color: #374151;
}
.usage-default-tooltip--compact {
	width: 224px;
	padding: 8px;
}
.usage-default-tooltip--compact .usage-default-tooltip-label {
	padding: 0;
	border: 0;
	font-weight: 400;
	color: #111827;
}
.usage-default-tooltip--compact .usage-default-tooltip-rows {
	padding: 0;
	gap: 0;
}
.usage-default-tooltip--compact .usage-default-tooltip-rows > div {
	gap: 16px;
}
.usage-default-tooltip--compact .usage-default-tooltip-rows i {
	width: 8px;
	height: 8px;
	border: 0;
	box-shadow: 0 0 0 2px white;
	filter: drop-shadow(0 4px 3px #00000012) drop-shadow(0 2px 2px #0000000f);
}
.usage-default-tooltip--compact .usage-default-tooltip-rows p {
	font-weight: 500;
}
</style>
