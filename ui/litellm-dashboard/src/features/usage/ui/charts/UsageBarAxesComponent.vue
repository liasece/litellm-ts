<script setup lang="ts">
import type { UsageBarGeometry } from "../../support/UsageBarGeometryModels";
defineProps<{ geometry: UsageBarGeometry }>();
</script>
<template>
	<svg
		class="usage-native-bar-axes"
		:width="geometry.width"
		:height="geometry.height"
		:viewBox="`0 0 ${geometry.width} ${geometry.height}`"
		aria-hidden="true"
	>
		<g fill="none" stroke="#e5e7eb"><line v-for="(line, index) in geometry.grid" :key="index" v-bind="line" /></g>
		<g v-if="geometry.ranking" fill="none" stroke="#666">
			<line
				:x1="geometry.left"
				:y1="geometry.top + geometry.plotHeight"
				:x2="geometry.left + geometry.plotWidth"
				:y2="geometry.top + geometry.plotHeight"
			/>
			<line
				v-for="(tick, index) in geometry.xTicks"
				:key="index"
				:x1="tick.markX ?? tick.x"
				:x2="tick.markX ?? tick.x"
				:y1="geometry.top + geometry.plotHeight + 6"
				:y2="geometry.top + geometry.plotHeight"
			/>
		</g>
		<g
			:style="{
				fontSize: geometry.ranking ? '16px' : '12px',
				lineHeight: geometry.ranking ? '24px' : '4.8px',
				fill: geometry.ranking ? '#666' : '#6b7280',
			}"
		>
			<text
				v-for="(tick, index) in [...geometry.xTicks, ...geometry.yTicks]"
				:key="index"
				:x="tick.x"
				:y="tick.y"
				:transform="tick.transform"
				:text-anchor="tick.anchor"
			>
				<tspan :x="tick.x" :dy="tick.dy">{{ tick.text }}</tspan>
			</text>
		</g>
	</svg>
</template>
<style>
.usage-native-bar-axes {
	position: absolute;
	inset: 0;
	pointer-events: none;
	max-width: none;
}
</style>
