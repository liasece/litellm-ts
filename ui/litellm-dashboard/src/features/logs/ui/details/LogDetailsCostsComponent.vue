<script setup lang="ts">
import { computed } from "vue";
import type { LogEntry } from "../../support/LogsModels";
import { costView } from "../../logic/LogDetailsMetricsLogic";
import { formatFreshness } from "../../../models/support/UpstreamModelInfoModels";
import { priceBackfill, priceSnapshot, priceSnapshotRows, upstreamPriceFields } from "../../support/LogsPriceModels";
import { useMoneyFormatter } from "../../../platform/stores/PriceDisplayStore";
import LogsPriceTierBadge from "../LogsPriceTierBadgeComponent.vue";
const props = defineProps<{ log: LogEntry }>();
const money = useMoneyFormatter();
const view = computed(() =>
	costView(
		props.log.metadata?.cost_breakdown,
		props.log.spend ?? 0,
		props.log.prompt_tokens,
		props.log.completion_tokens,
		props.log.cache_hit,
	),
);
const format = (value: number | undefined) => money(value, 8, props.log);
// 单价在请求发生时冻结；详情页直接铺开，不再用图标让人猜来源。
const snapshot = computed(() => priceSnapshot(props.log));
const priceRows = computed(() => (snapshot.value === undefined ? [] : priceSnapshotRows(snapshot.value)));
const upstreamPriced = computed(() => upstreamPriceFields(snapshot.value).length > 0);
// 补记行不冒充“请求时冻结”：标题与角标都标出来，鼠标悬停给出补记原因。
const backfill = computed(() => priceBackfill(props.log));
const percent = (value: number | undefined) => (value === undefined ? "-" : (value * 100).toFixed(2) + "%");
</script>
<template>
	<div v-if="view.visible" class="ld-costs">
		<div v-if="snapshot && priceRows.length > 0" class="ld-costs__prices">
			<div class="ld-costs__prices-title">
				计费单价（{{ backfill ? "事后补记" : "请求时冻结" }}）
				<LogsPriceTierBadge :peak="snapshot.peak" />
				<span v-if="upstreamPriced" class="ld-costs__prices-badge">含上游价</span>
				<span v-if="backfill" class="ld-costs__prices-badge is-backfill" :title="backfill.reason ?? backfill.at">补记</span>
			</div>
			<div class="ld-costs__prices-rows">
				<span v-for="row in priceRows" :key="row.field" class="ld-costs__prices-item" :class="{ 'is-upstream': row.fromUpstream }">
					<span class="ld-costs__muted">{{ row.label }}</span>
					<span
						:title="
							snapshot.peak && snapshot.peak.multiplier > 1
								? `基础价 ${row.perMillion}/1M ×${snapshot.peak.multiplier}`
								: undefined
						"
						>{{ row.appliedPerMillion }}/1M</span
					>
					<span class="ld-costs__muted">{{ row.sourceLabel }}</span>
				</span>
			</div>
			<div v-if="snapshot.upstream" class="ld-costs__prices-source">
				上游 {{ snapshot.upstream.upstreamModel }} · {{ snapshot.upstream.source }} · 抓取于
				{{ formatFreshness(snapshot.upstream.fetchedAt) }}
			</div>
		</div>
		<div class="ld-costs__group">
			<div class="ld-costs__row">
				<span>Input Cost:</span
				><span
					>{{ format(view.input)
					}}<span v-if="log.prompt_tokens !== undefined" class="ld-costs__muted">
						({{ log.prompt_tokens?.toLocaleString() }} prompt tokens)</span
					></span
				>
			</div>
			<div class="ld-costs__row">
				<span>Output Cost:</span
				><span
					>{{ format(view.output)
					}}<span v-if="log.completion_tokens !== undefined" class="ld-costs__muted">
						({{ log.completion_tokens?.toLocaleString() }} completion tokens)</span
					></span
				>
			</div>
			<div v-if="(view.number('tool_usage_cost') ?? 0) > 0" class="ld-costs__row">
				<span>Tool Usage Cost:</span><span>{{ format(view.number("tool_usage_cost")) }}</span>
			</div>
			<div v-for="[key, value] in view.additional" :key="key" class="ld-costs__row">
				<span>{{ key }}:</span><span>{{ format(value) }}</span>
			</div>
		</div>
		<div v-if="!view.isCached" class="ld-costs__original">
			<div class="ld-costs__row">
				<span>Original LLM Cost:</span><span>{{ format(view.original) }}</span>
			</div>
		</div>
		<div v-if="view.discount || view.margin" class="ld-costs__adjustments">
			<div v-if="view.number('discount_percent')" class="ld-costs__row">
				<span>Discount ({{ percent(view.number("discount_percent")) }}):</span
				><span>-{{ format(view.number("discount_amount")) }}</span>
			</div>
			<div v-if="view.number('discount_amount') !== undefined && view.number('discount_percent') === undefined" class="ld-costs__row">
				<span>Discount Amount:</span><span>-{{ format(view.number("discount_amount")) }}</span>
			</div>
			<div v-if="view.number('margin_percent')" class="ld-costs__row">
				<span>Margin ({{ percent(view.number("margin_percent")) }}):</span
				><span>+{{ format((view.number("margin_total_amount") || 0) - (view.number("margin_fixed_amount") || 0)) }}</span>
			</div>
			<div v-if="view.number('margin_fixed_amount')" class="ld-costs__row">
				<span>Margin:</span><span>+{{ format(view.number("margin_fixed_amount")) }}</span>
			</div>
		</div>
		<div class="ld-costs__final">
			<div class="ld-costs__row">
				<span>Final Calculated Cost:</span><span>{{ format(view.total) }}{{ view.isCached ? " (Cached)" : "" }}</span>
			</div>
		</div>
	</div>
</template>
