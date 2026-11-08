<script setup lang="ts">
import type { SpeedChartGeometry } from "../support/SpeedChartModels";
defineProps<{ geometry: SpeedChartGeometry; cursorX?: number }>();
const coordinate = (value: number) => String(Math.round(value * 1000) / 1000);
</script>
<template>
	<svg
		class="speed-chart-axes"
		:width="geometry.width"
		:height="geometry.height"
		:viewBox="'0 0 ' + geometry.width + ' ' + geometry.height"
		aria-hidden="true"
	>
		<g stroke="#9ca3af" fill="none">
			<line
				:x1="geometry.left"
				:y1="geometry.height - geometry.bottom"
				:x2="geometry.width - geometry.right"
				:y2="geometry.height - geometry.bottom"
			/>
			<line :x1="geometry.left" :y1="geometry.top" :x2="geometry.left" :y2="geometry.height - geometry.bottom" />
			<line
				v-for="tick in geometry.xTicks"
				:key="'x-' + tick.value"
				:x1="tick.coordinate"
				:x2="tick.coordinate"
				:y1="geometry.height - geometry.bottom + 6"
				:y2="geometry.height - geometry.bottom"
			/>
			<line
				v-for="tick in geometry.yTicks"
				:key="'y-' + tick.value"
				:x1="geometry.left - 6"
				:x2="geometry.left"
				:y1="tick.coordinate"
				:y2="tick.coordinate"
			/>
		</g>
		<g fill="#9ca3af" stroke="none" font-size="10">
			<text
				v-for="tick in geometry.xTicks"
				:key="'x-label-' + tick.value"
				:x="tick.labelCoordinate"
				:y="geometry.height - geometry.bottom + 8"
				text-anchor="middle"
			>
				<tspan :x="tick.labelCoordinate" dy="0.71em">{{ tick.label }}</tspan>
			</text>
			<text
				v-for="tick in geometry.yTicks"
				:key="'y-label-' + tick.value"
				:x="geometry.left - 8"
				:y="tick.labelCoordinate"
				text-anchor="end"
			>
				<tspan :x="geometry.left - 8" dy="0.355em">{{ tick.label }}</tspan>
			</text>
		</g>
		<path
			v-if="cursorX !== undefined"
			stroke="#ccc"
			fill="none"
			:d="'M' + coordinate(cursorX) + ',' + geometry.top + 'L' + coordinate(cursorX) + ',' + (geometry.height - geometry.bottom)"
		/>
	</svg>
</template>
