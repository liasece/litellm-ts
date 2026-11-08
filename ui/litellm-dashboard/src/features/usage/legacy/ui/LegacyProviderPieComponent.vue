<script setup lang="ts">
import { computed, ref } from "vue";
import VChart from "vue-echarts";
import { use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { PieChart } from "echarts/charts";
import type { LegacyRow } from "../api/LegacyUsageApi";
import { useMoneyFormatter } from "../../../platform/stores/PriceDisplayStore";
use([SVGRenderer, PieChart]);
const props = defineProps<{ data: LegacyRow[] }>(),
	money = useMoneyFormatter(),
	hover = ref<LegacyRow | null>(null),
	position = ref({ x: 0, y: 0 });
const option = computed(() => ({
	animation: false,
	color: ["#06b6d4"],
	series: [
		{
			type: "pie",
			/* Tremor's pie variant draws a full circle that fills the chart box. */
			radius: ["0%", "100%"],
			label: { show: false },
			itemStyle: { borderWidth: 2, borderColor: "#fff" },
			data: props.data.map((row) => ({ name: String(row.provider), value: Number(row.spend) })),
		},
	],
}));
function pointer(value: unknown) {
	const event = value as { dataIndex?: number; event?: { event?: MouseEvent } };
	if (event.dataIndex === undefined) return;
	hover.value = props.data[event.dataIndex];
	position.value = { x: event.event?.event?.clientX || 0, y: event.event?.event?.clientY || 0 };
}
</script>
<template>
	<div class="legacy-provider-pie" @mouseleave="hover = null">
		<VChart
			:option="option"
			:init-options="{ renderer: 'svg' }"
			autoresize
			@mouseover="pointer"
			@mousemove="pointer"
			@globalout="hover = null"
		/><Teleport to="body"
			><div v-if="hover" class="legacy-pie-tooltip" :style="{ left: position.x + 8 + 'px', top: position.y + 8 + 'px' }">
				<strong>{{ hover.provider }}</strong>
				<p>spend: {{ money(Number(hover.spend), 2) }}</p>
			</div></Teleport
		>
	</div>
</template>
