<script setup lang="ts">
import { computed } from "vue";
import UsageChart from "./charts/UsageChartComponent.vue";
import UsageChartLoader from "./UsageChartLoaderComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import { activityTooltipRows, type ActivitySeries, type ActivitySeriesChart } from "../logic/UsageSeriesLogic";
import type { ChartRow } from "../logic/UsageChartLogic";
import { padUsageRows } from "../logic/UsageEmptyDaysLogic";
/**
 * 一张「按实体分色的每日堆叠柱状图」。
 *
 * Cost 页的两个每日图与 Activity 页的趋势图共用这里的标题、图例、刻度与悬浮提示，
 * 两处看同一份数据的读法才不会分叉；差异只在外面包哪张卡片、用什么栅格。
 */
const props = defineProps<{
	chart: "tokens" | "spend";
	series: ActivitySeries;
	entityKind: "model" | "key" | "mcp" | "endpoint" | "agent" | "account";
	/** 所选范围内每一天；用来给没有请求的日子补占位。 */
	dates?: string[];
	/** 明细还在路上时先撑住卡片，避免先闪一句「范围内没有用量」。 */
	loading?: boolean;
	isDateChanging?: boolean;
}>();
const money = useMoneyFormatter();
const NOUNS = { model: "Model", key: "Key", mcp: "MCP Server", endpoint: "Endpoint", agent: "Agent", account: "Account" } as const;
/** 句中用的小写说法；MCP 是缩写，不能整词转小写。 */
const LOWER = { model: "model", key: "key", mcp: "MCP server", endpoint: "endpoint", agent: "agent", account: "account" } as const;
const noun = computed(() => NOUNS[props.entityKind]);
const nounLower = computed(() => LOWER[props.entityKind]);
const current = computed<ActivitySeriesChart>(() => props.series[props.chart]);
const rows = computed(() => padUsageRows(current.value.rows, props.dates ?? []));
const title = computed(() => (props.chart === "tokens" ? `Tokens Over Time by ${noun.value}` : `Spend Over Time by ${noun.value}`));
const hint = computed(() =>
	props.chart === "tokens" ? `Daily total tokens, one color per ${nounLower.value}.` : `Daily spend, one color per ${nounLower.value}.`,
);
/**
 * 十亿级 token 用 1.2B 这类紧凑写法，否则纵轴会被 11 位数字撑爆。
 * 刻度值来自浮点除法（可能是 999999999.9999999），阈值留半个单位再取整，避免
 * 同一根轴上出现 “2.0B” 与 “1,000,000,000” 两种写法互相挤压。
 */
function tokens(value: number): string {
	const magnitude = Math.abs(value);
	if (magnitude >= 1e9 - 0.5) return formatNumberWithCommas(value, 1, true);
	if (magnitude >= 1e6 - 0.5) return formatNumberWithCommas(value, 0, true);
	return formatNumberWithCommas(value, 0, false);
}
function exactTokens(value: number): string {
	return formatNumberWithCommas(value, 0, false);
}
function spend(value: number): string {
	return money(value, 2);
}
function axisSpend(value: number): string {
	return money(value, "compact");
}
function format(value: number): string {
	return props.chart === "tokens" ? tokens(value) : axisSpend(value);
}
function tooltipRows(row: ChartRow) {
	return activityTooltipRows(current.value, row);
}
function day(row: ChartRow): string {
	return String(row.date ?? "");
}
</script>
<template>
	<div class="usage-series-chart">
		<div class="usage-trends-head">
			<h2>{{ title }}</h2>
			<p class="usage-trends-hint">{{ hint }}</p>
		</div>
		<UsageChartLoader v-if="loading" :is-date-changing="isDateChanging" />
		<template v-else>
			<div v-if="current.slices.length" class="usage-trends-legend">
				<span v-for="slice in current.slices" :key="slice.label" :title="slice.label"
					><i :style="{ backgroundColor: slice.color }" />{{ slice.label }}</span
				>
			</div>
			<p v-else class="usage-trends-empty">No {{ nounLower }} usage in the selected range.</p>
			<UsageChart
				v-if="current.slices.length"
				:data="rows"
				index="date"
				:categories="current.categories"
				:colors="current.colors"
				kind="bar"
				stack
				:legend="false"
				:height="260"
				:y-axis-width="chart === 'tokens' ? 72 : 76"
				:format="format"
			>
				<template #tooltip="{ row }"
					><div class="usage-trends-tooltip">
						<p class="usage-trends-tooltip-date">{{ day(row) }}</p>
						<div v-for="entry in tooltipRows(row)" :key="entry.label">
							<span :title="entry.label"><i :style="{ backgroundColor: entry.color }" />{{ entry.label }}</span
							><b>{{ chart === "tokens" ? exactTokens(entry.value) : spend(entry.value) }}</b>
						</div>
					</div></template
				>
			</UsageChart>
		</template>
	</div>
</template>
