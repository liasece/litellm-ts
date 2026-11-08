<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import VChart from "vue-echarts";
import { use, type ComposeOption } from "echarts/core";
import { PieChart, type PieSeriesOption } from "echarts/charts";
import { TooltipComponent, type TooltipComponentOption } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { ChartRow } from "../../logic/UsageChartLogic";
import { usageDonutGeometry, usageDonutTooltipPosition } from "../../logic/UsageDonutChartLogic";
use([PieChart, TooltipComponent, SVGRenderer]);
const props = withDefaults(
	defineProps<{
		data: readonly ChartRow[];
		index: string;
		category: string;
		colors?: readonly string[];
		height?: number;
		format?: (value: number) => string;
	}>(),
	{ colors: () => ["cyan", "blue", "indigo", "violet", "purple"], height: 160, format: (value: number) => value.toLocaleString() },
);
const emit = defineEmits<{ select: [row: ChartRow] }>();
const root = ref<HTMLElement>(),
	tooltip = ref<HTMLElement>(),
	width = ref(0),
	active = ref<number | null>(null);
const tooltipSize = ref({ width: 0, height: 0 });
const geometry = computed(() => usageDonutGeometry({ ...props, width: width.value }));
let observer: ResizeObserver | undefined;
watch(
	root,
	(element) => {
		observer?.disconnect();
		if (!element) return;
		const measure = () => {
			width.value = element.clientWidth;
			active.value = null;
		};
		measure();
		observer = new ResizeObserver(measure);
		observer.observe(element);
	},
	{ flush: "post" },
);
onBeforeUnmount(() => observer?.disconnect());
const option = computed<ComposeOption<PieSeriesOption | TooltipComponentOption>>(() => ({
	animation: false,
	tooltip: { show: false },
	series: [
		{
			type: "pie",
			radius: [geometry.value.innerRadius, geometry.value.outerRadius],
			center: [geometry.value.center.x, geometry.value.center.y],
			startAngle: 90,
			clockwise: true,
			minAngle: 0,
			padAngle: 0,
			stillShowZeroSum: false,
			showEmptyCircle: false,
			selectedMode: false,
			cursor: "default",
			label: { show: false },
			labelLine: { show: false },
			itemStyle: { borderColor: "#fff", borderWidth: 1, borderJoin: "round" },
			emphasis: { disabled: true, scale: false },
			data: geometry.value.sectors.map((sector) => ({ name: sector.name, value: sector.value, itemStyle: { color: sector.color } })),
		},
	],
}));
function pointer(event: unknown) {
	if (!event || typeof event !== "object" || !("dataIndex" in event)) return;
	const index = Number(event.dataIndex);
	if (Number.isInteger(index) && geometry.value.sectors[index]) active.value = index;
}
function select(event: unknown) {
	pointer(event);
	if (active.value !== null) {
		const sector = geometry.value.sectors[active.value];
		if (sector) emit("select", sector.row);
	}
}
const selected = computed(() => (active.value !== null ? geometry.value.sectors[active.value] : undefined));
watch(
	[tooltip, selected],
	async () => {
		await nextTick();
		const box = tooltip.value?.getBoundingClientRect();
		if (box) tooltipSize.value = { width: box.width, height: box.height };
	},
	{ flush: "post" },
);
watch(
	() => props.data,
	() => {
		active.value = null;
	},
);
const tooltipPosition = computed(() => {
	if (!selected.value) return undefined;
	const x = usageDonutTooltipPosition(selected.value.anchor.x, tooltipSize.value.width, width.value);
	const y = usageDonutTooltipPosition(selected.value.anchor.y, tooltipSize.value.height, props.height);
	return { transform: "translate(" + x + "px," + y + "px)" };
});
</script>
<template>
	<div
		ref="root"
		class="usage-donut-chart"
		:style="{ height: height + 'px' }"
		data-testid="usage-donut-chart"
		@mouseleave="active = null"
	>
		<template v-if="data.length">
			<VChart
				v-if="width"
				:option="option"
				:init-options="{ renderer: 'svg' }"
				autoresize
				@mouseover="pointer"
				@mousemove="pointer"
				@mouseout="active = null"
				@globalout="active = null"
				@click="select"
			/>
			<svg
				v-if="width"
				class="usage-donut-label"
				:width="width"
				:height="height"
				:viewBox="'0 0 ' + width + ' ' + height"
				aria-hidden="true"
			>
				<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle">{{ format(geometry.total) }}</text>
			</svg>
			<div v-if="selected" ref="tooltip" class="usage-donut-tooltip" :style="tooltipPosition" role="tooltip">
				<div class="usage-donut-tooltip__row">
					<div class="usage-donut-tooltip__name">
						<span class="usage-donut-tooltip__swatch" :style="{ backgroundColor: selected.color }" />
						<p>{{ selected.name }}</p>
					</div>
					<p class="usage-donut-tooltip__value">{{ format(selected.value) }}</p>
				</div>
			</div>
		</template>
		<div v-else class="usage-donut-empty">No data</div>
	</div>
</template>
<style>
.usage-donut-chart {
	position: relative;
	width: 100%;
}
.usage-donut-label {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
}
.usage-donut-label text {
	fill: #374151;
	font: 16px/24px var(--ui-font-sans);
}
.usage-donut-tooltip {
	position: absolute;
	top: 0;
	left: 0;
	z-index: 10;
	pointer-events: none;
	border: 1px solid var(--ui-tremor-border);
	border-radius: 8px;
	background: #fff;
	padding: 8px 16px;
	font: 12.4px/18.4px var(--ui-font-sans);
	color: #6b7280;
	box-shadow:
		0 4px 6px -1px rgb(0 0 0 / 10%),
		0 2px 4px -2px rgb(0 0 0 / 10%);
}
.usage-donut-tooltip p {
	margin: 0;
	white-space: nowrap;
	text-align: right;
}
.usage-donut-tooltip__row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 32px;
}
.usage-donut-tooltip__name {
	display: flex;
	align-items: center;
	gap: 8px;
}
.usage-donut-tooltip__swatch {
	flex-shrink: 0;
	width: 12px;
	height: 12px;
	border: 2px solid #fff;
	border-radius: 9999px;
	box-shadow:
		0 1px 3px 0 rgb(0 0 0 / 10%),
		0 1px 2px -1px rgb(0 0 0 / 10%);
}
.usage-donut-tooltip .usage-donut-tooltip__value {
	font-weight: 500;
	font-variant-numeric: tabular-nums;
	color: #374151;
}
.usage-donut-empty {
	display: flex;
	height: 100%;
	align-items: center;
	justify-content: center;
	font: 12.4px/18.4px var(--ui-font-sans);
	color: #6b7280;
}
</style>
