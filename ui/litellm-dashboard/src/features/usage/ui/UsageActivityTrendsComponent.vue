<script setup lang="ts">
import { computed } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UsageChart from "./charts/UsageChartComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import { activityTooltipRows, type ActivitySeries, type ActivitySeriesChart } from "../logic/UsageSeriesLogic";
import type { ChartRow } from "../logic/UsageChartLogic";
const props = defineProps<{ series: ActivitySeries; entityKind: "model" | "key" | "mcp" | "endpoint" | "agent" }>();
const money = useMoneyFormatter();
const NOUNS = { model: "Model", key: "Key", mcp: "MCP Server", endpoint: "Endpoint", agent: "Agent" } as const;
/** 句中用的小写说法；MCP 是缩写，不能整词转小写。 */
const LOWER = { model: "model", key: "key", mcp: "MCP server", endpoint: "endpoint", agent: "agent" } as const;
const noun = computed(() => NOUNS[props.entityKind]);
const nounLower = computed(() => LOWER[props.entityKind]);
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
function tooltipRows(chart: ActivitySeriesChart, row: ChartRow) {
	return activityTooltipRows(chart, row);
}
function day(row: ChartRow): string {
	return String(row.date ?? "");
}
</script>
<template>
	<section class="usage-trends">
		<UiCard appearance="tremor" class="usage-trends-card" data-testid="activity-tokens-trend">
			<div class="usage-trends-head">
				<h2>Tokens Over Time by {{ noun }}</h2>
				<p class="usage-trends-hint">Daily total tokens, one color per {{ nounLower }}.</p>
			</div>
			<div v-if="series.tokens.slices.length" class="usage-trends-legend">
				<span v-for="slice in series.tokens.slices" :key="slice.label" :title="slice.label"
					><i :style="{ backgroundColor: slice.color }" />{{ slice.label }}</span
				>
			</div>
			<p v-else class="usage-trends-empty">No {{ nounLower }} usage in the selected range.</p>
			<UsageChart
				v-if="series.tokens.slices.length"
				:data="series.tokens.rows"
				index="date"
				:categories="series.tokens.categories"
				:colors="series.tokens.colors"
				kind="bar"
				stack
				:legend="false"
				:height="260"
				:y-axis-width="72"
				:format="tokens"
			>
				<template #tooltip="{ row }"
					><div class="usage-trends-tooltip">
						<p class="usage-trends-tooltip-date">{{ day(row) }}</p>
						<div v-for="entry in tooltipRows(series.tokens, row)" :key="entry.label">
							<span :title="entry.label"><i :style="{ backgroundColor: entry.color }" />{{ entry.label }}</span
							><b>{{ exactTokens(entry.value) }}</b>
						</div>
					</div></template
				>
			</UsageChart>
		</UiCard>
		<UiCard appearance="tremor" class="usage-trends-card" data-testid="activity-spend-trend">
			<div class="usage-trends-head">
				<h2>Spend Over Time by {{ noun }}</h2>
				<p class="usage-trends-hint">Daily spend, one color per {{ nounLower }}.</p>
			</div>
			<div v-if="series.spend.slices.length" class="usage-trends-legend">
				<span v-for="slice in series.spend.slices" :key="slice.label" :title="slice.label"
					><i :style="{ backgroundColor: slice.color }" />{{ slice.label }}</span
				>
			</div>
			<p v-else class="usage-trends-empty">No {{ nounLower }} usage in the selected range.</p>
			<UsageChart
				v-if="series.spend.slices.length"
				:data="series.spend.rows"
				index="date"
				:categories="series.spend.categories"
				:colors="series.spend.colors"
				kind="bar"
				stack
				:legend="false"
				:height="260"
				:y-axis-width="76"
				:format="axisSpend"
			>
				<template #tooltip="{ row }"
					><div class="usage-trends-tooltip">
						<p class="usage-trends-tooltip-date">{{ day(row) }}</p>
						<div v-for="entry in tooltipRows(series.spend, row)" :key="entry.label">
							<span :title="entry.label"><i :style="{ backgroundColor: entry.color }" />{{ entry.label }}</span
							><b>{{ spend(entry.value) }}</b>
						</div>
					</div></template
				>
			</UsageChart>
		</UiCard>
	</section>
</template>
