<script setup lang="ts">
import "../../styles/UsageChartsStyles.css";
import { computed, onBeforeUnmount, onMounted, ref, useSlots, watch } from "vue";
import VChart from "vue-echarts";
import { use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { CustomChart } from "echarts/charts";
import { chartValue, usageColors, type ChartRow } from "../../logic/UsageChartLogic";
use([SVGRenderer, CustomChart]);
import { usageBarGeometry } from "../../logic/UsageBarGeometryLogic";
import { measureUsageTickText } from "../../render/UsageTickTextRender";
import UsageBarAxes from "./UsageBarAxesComponent.vue";
import UsageChartLegend from "./UsageChartLegendComponent.vue";
import UsageDonutChart from "./UsageDonutChartComponent.vue";
import UsageDefaultTooltip from "./UsageDefaultTooltipComponent.vue";
import { usageChartRowAt, usageCategoryCoordinate } from "../../logic/UsageChartPointerLogic";
import { usageLineGeometry } from "../../logic/UsageLineGeometryLogic";
import { usageLineSeries } from "../../logic/UsageLineSeriesLogic";
import { usageRankingViewport, usageDrawingPoint } from "../../logic/UsageRankingViewportLogic";
import UsageChartDrawingLayer from "../../render/UsageChartDrawingLayerRender";
const props = withDefaults(
	defineProps<{
		data: readonly ChartRow[];
		index: string;
		categories: string[];
		colors?: string[];
		kind?: "bar" | "line" | "area" | "donut";
		curve?: "linear" | "natural";
		connectNulls?: boolean;
		horizontal?: boolean;
		height?: number;
		yAxisWidth?: number;
		legend?: boolean;
		legendHeight?: number;
		stack?: boolean;
		format?: (value: number) => string;
		ranking?: boolean;
		tooltipTone?: "light" | "dark";
		showXAxis?: boolean;
		modelTooltip?: boolean;
	}>(),
	{
		colors: () => ["cyan"],
		kind: "bar",
		curve: "linear",
		tooltipTone: "light",
		showXAxis: true,
		modelTooltip: false,
		height: 320,
		yAxisWidth: 56,
		legendHeight: 60,
		format: (v: number) => v.toLocaleString(),
	},
);
const emit = defineEmits<{ select: [row: ChartRow] }>();
const chartInitOptions = { renderer: "svg" as const };
const root = ref<HTMLElement>(),
	hover = ref<{ row: ChartRow; rowIndex: number; x: number; y: number; transform?: string } | null>(null);
const slots = useSlots(),
	tooltipBox = ref<HTMLElement>();
const width = ref(0),
	viewportSize = ref({ width: 0, height: 0 });
let observer: ResizeObserver | undefined;
let lastPointer: Pick<MouseEvent, "clientX" | "clientY"> | null = null;
function measureChart() {
	const element = root.value;
	if (!element) return;
	width.value = element.clientWidth;
	const bounds = element.getBoundingClientRect();
	viewportSize.value = { width: bounds.width, height: bounds.height };
}
onMounted(() => {
	if (root.value) {
		measureChart();
		observer = new ResizeObserver(measureChart);
		observer.observe(root.value);
	}
});
onBeforeUnmount(() => observer?.disconnect());
const lineGeometry = computed(() =>
	["area", "line"].includes(props.kind)
		? usageLineGeometry({
				...props,
				width: width.value,
				legendHeight: props.legend ? props.legendHeight : 0,
				measureText: measureUsageTickText,
			})
		: null,
);
const geometry = computed(() =>
	props.kind === "bar"
		? usageBarGeometry({
				...props,
				width: width.value,
				legendHeight: props.legend ? props.legendHeight : 0,
				measureText: measureUsageTickText,
			})
		: (lineGeometry.value?.axes ?? null),
);
const rankingViewport = computed(() =>
	props.ranking && geometry.value
		? usageRankingViewport(geometry.value.width, geometry.value.height, viewportSize.value.width, viewportSize.value.height)
		: null,
);
watch(
	[geometry, rankingViewport],
	() => {
		if (lastPointer) plotPointer(lastPointer);
	},
	{ flush: "post" },
);
const palette = computed(() => props.colors.map((c) => usageColors[c] ?? c));
const option = computed(() => {
	if (lineGeometry.value) return { animation: false, series: usageLineSeries(lineGeometry.value, palette.value, props.kind === "area") };
	if (geometry.value) {
		const layout = geometry.value;
		return {
			animation: false,
			series: props.categories.map((key, seriesIndex) => ({
				name: key,
				type: "custom",
				coordinateSystem: "none",
				emphasis: { disabled: true },
				data: props.data.map((row, rowIndex) => [rowIndex, chartValue(row, key) ?? 0]),
				renderItem: (params: { dataIndex: number }) => {
					const bar = layout.bars.find((bar) => bar.rowIndex === params.dataIndex && bar.seriesIndex === seriesIndex);
					return bar
						? {
								type: "rect",
								emphasisDisabled: true,
								shape: { x: bar.x, y: bar.y, width: bar.width, height: bar.height },
								style: { fill: palette.value[seriesIndex % palette.value.length] },
							}
						: undefined;
				},
			})),
		};
	}
	return { animation: false, series: [] };
});
const tooltipPosition = computed(() => {
	const point = hover.value;
	if (!point) return {};
	const bounds = root.value?.getBoundingClientRect();
	if (props.ranking) return { left: point.x + "px", top: point.y + "px", transform: point.transform };

	const origin = bounds?.left ?? 0,
		tooltipWidth = tooltipBox.value?.getBoundingClientRect().width ?? 0;
	let left = point.x - origin + 10;
	if (bounds && left + tooltipWidth > bounds.width) left = point.x - origin - 10 - tooltipWidth;
	// The original tooltip uses a translated child; preserve its fractional placement.
	return { left: origin + "px", top: point.y + "px", transform: `translate(${Math.max(0, left)}px,0px)` };
});
const cursor = computed(() => {
	if (!geometry.value || !hover.value) return null;
	const layout = geometry.value,
		coordinate = usageCategoryCoordinate(layout, props.data.length, hover.value.rowIndex, lineGeometry.value?.positions);
	if (lineGeometry.value) return { kind: "line", x: coordinate, y: layout.top, width: 0, height: layout.plotHeight };
	const band = (layout.horizontal ? layout.plotHeight : layout.plotWidth - 40) / props.data.length;
	return layout.horizontal
		? { kind: "bar", curve: "linear", x: layout.left, y: coordinate - band / 2, width: layout.plotWidth, height: band }
		: { kind: "bar", curve: "linear", x: coordinate - band / 2, y: layout.top, width: band, height: layout.plotHeight };
});
function plotPointer(event: Pick<MouseEvent, "clientX" | "clientY">) {
	lastPointer = { clientX: event.clientX, clientY: event.clientY };
	const bounds = root.value?.getBoundingClientRect(),
		layout = geometry.value;
	if (!bounds || !layout) return;
	const point = usageDrawingPoint(rankingViewport.value, event.clientX - bounds.left, event.clientY - bounds.top);
	const rowIndex = usageChartRowAt(layout, props.data.length, point.x, point.y, lineGeometry.value?.positions);
	if (rowIndex === null) {
		hover.value = null;
		return;
	}
	const coordinate = usageCategoryCoordinate(layout, props.data.length, rowIndex, lineGeometry.value?.positions);
	if (props.ranking) {
		const viewport = root.value?.parentElement?.getBoundingClientRect() ?? bounds,
			// The original HTML portal is anchored in unscaled Recharts coordinates.
			x = bounds.left + Math.round(event.clientX - bounds.left) / (rankingViewport.value?.pointerScale ?? 1),
			y = bounds.top + coordinate;
		const left = x > viewport.left + (viewport.width * 2) / 3,
			above = y > viewport.top + viewport.height / 2;
		hover.value = {
			row: props.data[rowIndex],
			rowIndex,
			x: x + (left ? -8 : 8),
			y: y + (above ? -8 : 8),
			transform: `translate(${left ? "-100%" : "0"},${above ? "-100%" : "0"})`,
		};
	} else hover.value = { row: props.data[rowIndex], rowIndex, x: bounds.left + coordinate, y: bounds.top };
}
function leavePlot() {
	lastPointer = null;
	hover.value = null;
}
function pointer(params: unknown) {
	const event = params as { dataIndex?: number; event?: { event?: MouseEvent; offsetX?: number; offsetY?: number } };
	if (event.dataIndex === undefined || !props.data[event.dataIndex]) return;
	const mouse = event.event?.event,
		bounds = root.value?.getBoundingClientRect();
	if (mouse) {
		plotPointer(mouse);
		return;
	}
	hover.value = {
		row: props.data[event.dataIndex],
		rowIndex: event.dataIndex,
		x: (bounds?.left ?? 0) + (event.event?.offsetX ?? 0),
		y: (bounds?.top ?? 0) + (event.event?.offsetY ?? 0),
	};
}
function select(params: unknown) {
	const index = (params as { dataIndex: number }).dataIndex;
	if (props.data[index]) emit("select", props.data[index]);
}
</script>
<template>
	<UsageDonutChart
		v-if="kind === 'donut'"
		class="usage-chart"
		:data="data"
		:index="index"
		:category="categories[0]"
		:colors="palette"
		:height="height"
		:format="format"
		@select="emit('select', $event)"
	/>
	<div
		v-else
		ref="root"
		class="usage-chart"
		:style="{ height: height + 'px' }"
		@mouseleave="leavePlot"
		@mouseenter="plotPointer"
		@mousemove="plotPointer"
	>
		<UsageChartDrawingLayer :active="Boolean(ranking)" :viewport="rankingViewport">
			<UsageBarAxes v-if="geometry && data.length" :geometry="geometry" />
			<UsageChartLegend v-if="!ranking && legend && data.length" :categories="categories" :colors="palette" />
			<svg v-if="cursor && geometry" class="usage-chart-cursor" :width="geometry.width" :height="geometry.height" aria-hidden="true">
				<line
					v-if="cursor.kind === 'line'"
					:x1="cursor.x"
					:x2="cursor.x"
					:y1="cursor.y"
					:y2="cursor.y + cursor.height"
					stroke="#d1d5db"
				/>
				<rect
					v-else
					:x="cursor.x"
					:y="cursor.y"
					:width="cursor.width"
					:height="cursor.height"
					:fill="ranking ? '#ccc' : '#d1d5db'"
					:opacity="ranking ? 1 : 0.15"
				/>
			</svg>
			<VChart
				:option="option"
				:init-options="chartInitOptions"
				autoresize
				@mouseover="pointer"
				@mousemove="pointer"
				@globalout="hover = null"
				@click="select"
			/>
			<svg
				v-if="geometry && $slots.annotation"
				class="usage-chart-annotations"
				:width="geometry.width"
				:height="geometry.height"
				:viewBox="`0 0 ${geometry.width} ${geometry.height}`"
				aria-hidden="true"
			>
				<foreignObject
					v-for="bar in geometry.bars.filter((bar) => bar.seriesIndex === 0)"
					:key="bar.rowIndex"
					:x="bar.x + 8"
					:y="bar.y"
					:width="58"
					:height="bar.height"
					><div class="usage-chart-annotation"><slot name="annotation" :row="bar.row" /></div
				></foreignObject>
			</svg>
		</UsageChartDrawingLayer>
		<UsageChartLegend v-if="ranking && legend && data.length" :categories="categories" :colors="palette" />
		<div v-if="!data.length" class="usage-chart-empty">No data</div>
		<Teleport to="body"
			><div
				v-if="hover"
				ref="tooltipBox"
				class="usage-chart-tooltip"
				:class="{
					'usage-chart-tooltip--ranking': ranking,
					'usage-chart-tooltip--dark': tooltipTone === 'dark',
					'usage-chart-tooltip--custom': Boolean(slots.tooltip),
				}"
				:style="tooltipPosition"
			>
				<slot name="tooltip" :row="hover.row"
					><UsageDefaultTooltip
						:row="hover.row"
						:index="index"
						:categories="categories"
						:colors="palette"
						:format="format"
						:compact="kind === 'area'"
						:model-tooltip="modelTooltip"
				/></slot></div
		></Teleport>
	</div>
</template>

<style>
.usage-chart-annotations {
	position: absolute;
	inset: 0;
	pointer-events: none;
	max-width: none;
}
.usage-chart-annotation {
	display: flex;
	height: 100%;
	align-items: center;
	overflow: hidden;
	white-space: nowrap;
}
.usage-chart-annotation > span {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	color: #6b7280;
	font-size: 11px;
	line-height: 16.5px;
}
</style>
