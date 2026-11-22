<script setup lang="ts">
import { computed } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UsageChart from "./charts/UsageChartComponent.vue";
import UsageSeriesCard from "./UsageSeriesCardComponent.vue";
import { activityRateTooltipRows, type ActivitySeries } from "../logic/UsageSeriesLogic";
import type { ChartRow } from "../logic/UsageChartLogic";
import { padUsageRows } from "../logic/UsageEmptyDaysLogic";
const props = defineProps<{
	series: ActivitySeries;
	entityKind: "model" | "key" | "mcp" | "endpoint" | "agent" | "account";
	/** 所选范围内每一天；用来给三张图补齐没有请求的日子。 */
	dates?: string[];
}>();
const NOUNS = { model: "Model", key: "Key", mcp: "MCP Server", endpoint: "Endpoint", agent: "Agent", account: "Account" } as const;
/** 句中用的小写说法；MCP 是缩写，不能整词转小写。 */
const LOWER = { model: "model", key: "key", mcp: "MCP server", endpoint: "endpoint", agent: "agent", account: "account" } as const;
const noun = computed(() => NOUNS[props.entityKind]);
const nounLower = computed(() => LOWER[props.entityKind]);
function day(row: ChartRow): string {
	return String(row.date ?? "");
}
/**
 * 命中率图只画有 prompt tokens 的实体；它们全都没有缓存读取时，一条 0% 的平线不比一句结论
 * 更有信息量，还会把纵轴压成 0–4% 这种读不出刻度的区间。
 */
const hasCacheReads = computed(() => props.series.hitRate.slices.some((slice) => slice.cacheRead > 0));
const rateChartRows = computed(() => padUsageRows(props.series.hitRate.rows, props.dates ?? []));
const rateHint = computed(() =>
	props.series.hitRate.slices.length
		? "Cache never hit in this range: every prompt token was billed as uncached input."
		: `No prompt tokens recorded for any ${nounLower.value} in the selected range.`,
);
function rateRows(row: ChartRow) {
	return activityRateTooltipRows(props.series.hitRate, row);
}
</script>
<template>
	<section class="usage-trends">
		<UiCard appearance="tremor" class="usage-trends-card" data-testid="activity-tokens-trend">
			<UsageSeriesCard chart="tokens" :series="series" :entity-kind="entityKind" :dates="dates" />
		</UiCard>
		<UiCard appearance="tremor" class="usage-trends-card" data-testid="activity-spend-trend">
			<UsageSeriesCard chart="spend" :series="series" :entity-kind="entityKind" :dates="dates" />
		</UiCard>
		<UiCard appearance="tremor" class="usage-trends-card usage-trends-card--wide" data-testid="activity-hit-rate-trend">
			<div class="usage-trends-head">
				<h2>Cache Hit Rate Over Time by {{ noun }}</h2>
				<p class="usage-trends-hint">
					Daily cache-read share of prompt tokens, one color per {{ nounLower }}; days without requests are marked No data.
				</p>
			</div>
			<div v-if="hasCacheReads" class="usage-trends-legend">
				<span v-for="slice in series.hitRate.slices" :key="slice.label" :title="slice.label + ' · ' + slice.rate + '% cache hit'"
					><i :style="{ backgroundColor: slice.color }" />{{ slice.label }}<b>{{ slice.rate }}%</b></span
				>
			</div>
			<p v-if="!hasCacheReads" class="usage-trends-empty">{{ rateHint }}</p>
			<UsageChart
				v-else
				:data="rateChartRows"
				index="date"
				:categories="series.hitRate.categories"
				:colors="series.hitRate.colors"
				kind="line"
				:legend="false"
				:height="280"
				:y-axis-width="48"
				:format="(value) => Math.round(value) + '%'"
			>
				<template #tooltip="{ row }"
					><div class="usage-trends-tooltip">
						<p class="usage-trends-tooltip-date">{{ day(row) }}</p>
						<div v-for="entry in rateRows(row)" :key="entry.label">
							<span :title="entry.label"><i :style="{ backgroundColor: entry.color }" />{{ entry.label }}</span
							><b>{{ entry.value }}%</b>
						</div>
					</div></template
				>
			</UsageChart>
		</UiCard>
	</section>
</template>
