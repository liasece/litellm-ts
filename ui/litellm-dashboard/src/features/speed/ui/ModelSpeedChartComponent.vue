<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { use, graphic, type ComposeOption } from "echarts/core";
import { CustomChart, type CustomSeriesOption } from "echarts/charts";
import { SVGRenderer } from "echarts/renderers";
import VChart from "vue-echarts";
import { buildSpeedStrokeStops, formatTps, speedStrokeColor, type SpeedChartRow } from "../logic/ModelSpeedLogic";
import { speedChartGeometry, speedTooltipPosition } from "../logic/SpeedChartGeometryLogic";
import { completeSpeedTickMeasurement, measureSpeedTickText } from "../render/SpeedChartTextRender";
import type { SpeedBucket } from "../support/SpeedModels";
import SpeedChartAxesComponent from "./SpeedChartAxesComponent.vue";
use([CustomChart, SVGRenderer]);
const props = defineProps<{ rows: SpeedChartRow[]; bucket: SpeedBucket; timezone: string; yMax: number }>();
const root = ref<HTMLElement>(),
	tooltip = ref<HTMLElement>(),
	width = ref(0);
const hover = ref<{ index: number; y: number } | null>(null),
	tooltipSize = ref({ width: 0, height: 0 });
const values = computed(() => props.rows.flatMap((row) => (row.tps === null ? [] : [row.tps])));
const geometry = computed(() =>
	speedChartGeometry({
		rows: props.rows,
		bucket: props.bucket,
		timezone: props.timezone,
		maximum: props.yMax,
		width: width.value,
		measureLabel: measureSpeedTickText,
	}),
);
let observer: ResizeObserver | undefined;
watch(
	root,
	(element) => {
		observer?.disconnect();
		if (!element) return;
		const measure = () => {
			width.value = element.clientWidth;
			hover.value = null;
			// Populate the first axis measurement cache before the original10px phase.
			void geometry.value;
			void nextTick(completeSpeedTickMeasurement);
		};
		measure();
		observer = new ResizeObserver(measure);
		observer.observe(element);
	},
	{ flush: "post" },
);
onBeforeUnmount(() => observer?.disconnect());
const option = computed<ComposeOption<CustomSeriesOption>>(() => {
	const layout = geometry.value;
	const gradient = new graphic.LinearGradient(0, 0, 0, 1, buildSpeedStrokeStops(Math.min(...values.value), Math.max(...values.value)));
	return {
		animation: false,
		series: [
			{
				type: "custom",
				coordinateSystem: "none",
				data: [0],
				silent: true,
				renderItem: () => ({
					type: "group",
					children: [
						{
							type: "path",
							shape: { pathData: layout.path },
							style: { fill: "none", stroke: gradient, lineWidth: 2, lineCap: "butt", lineJoin: "miter" },
						},
					],
				}),
			},
		],
	};
});
function move(event: MouseEvent) {
	const element = root.value;
	if (!element || !props.rows.length) return;
	const rect = element.getBoundingClientRect(),
		x = event.clientX - rect.left,
		y = event.clientY - rect.top;
	const layout = geometry.value;
	if (x < layout.left || x > layout.width - layout.right || y < layout.top || y > layout.height - layout.bottom) {
		hover.value = null;
		return;
	}
	let index = 0,
		distance = Infinity;
	for (let candidate = 0; candidate < layout.coordinates.length; candidate++) {
		const difference = Math.abs(layout.coordinates[candidate]! - x);
		if (difference < distance) {
			distance = difference;
			index = candidate;
		}
	}
	hover.value = { index, y };
}
const activeRow = computed(() => (hover.value ? props.rows[hover.value.index] : undefined));
watch(
	[tooltip, activeRow],
	async () => {
		await nextTick();
		const rect = tooltip.value?.getBoundingClientRect();
		if (rect) tooltipSize.value = { width: rect.width, height: rect.height };
	},
	{ flush: "post" },
);
const position = computed(() => {
	const layout = geometry.value,
		active = hover.value;
	if (!active) return undefined;
	const x = speedTooltipPosition(
		layout.coordinates[active.index] ?? layout.left,
		tooltipSize.value.width,
		layout.left,
		layout.width - layout.right,
	);
	const y = speedTooltipPosition(active.y, tooltipSize.value.height, layout.top, layout.height - layout.bottom);
	return { transform: "translate(" + x + "px," + y + "px)" };
});
watch(
	() => props.rows,
	() => {
		hover.value = null;
	},
);
</script>
<template>
	<div v-if="values.length" ref="root" class="speed-chart" data-testid="model-speed-chart" @mousemove="move" @mouseleave="hover = null">
		<SpeedChartAxesComponent v-if="width" :geometry="geometry" :cursor-x="hover ? geometry.coordinates[hover.index] : undefined" />
		<VChart v-if="width" class="speed-chart-drawing" :option="option" :init-options="{ renderer: 'svg' }" autoresize />
		<svg v-if="width" class="speed-chart-dots" :width="width" height="88" :viewBox="'0 0 ' + width + ' 88'" aria-hidden="true">
			<circle
				v-for="dot in geometry.dots"
				:key="dot.index"
				:cx="dot.x"
				:cy="dot.y"
				:r="rows.length > 80 ? 1.6 : 2.4"
				:fill="speedStrokeColor(dot.row.tps!)"
				stroke="none"
			/>
		</svg>
		<div v-if="activeRow && activeRow.tps !== null" ref="tooltip" class="speed-chart-tooltip" :style="position" role="tooltip">
			<div>{{ activeRow.label }}</div>
			<div class="speed-tooltip-average">平均 {{ formatTps(activeRow.tps) }} TPS</div>
			<div>中位 {{ formatTps(activeRow.p50) }} · {{ activeRow.requests.toLocaleString("en-US") }} 个请求</div>
		</div>
	</div>
</template>
