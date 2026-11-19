<script setup lang="ts">
/**
 * 费用来源提示：只在本次请求确实按上游目录价计费时出现。
 *
 * 费用是历史事实，单价会变。气泡展示请求发生时冻结的单价（`price_snapshot`），
 * 以及当时上游目录里的价格与抓取时间；不拿今天的配置或上游目录解释旧账。
 * 配置价、价目表价的行不显示这个图标，避免每个 Cost 都挂入口。
 */

import { computed } from "vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import UiPopover from "../../platform/ui/UiPopover.vue";
import { formatFreshness } from "../../models/support/UpstreamModelInfoModels";
import {
	priceSnapshotRows,
	upstreamPriceFields,
	type LogPriceSnapshot,
	type PriceBackfill,
	type PriceSnapshotRow,
} from "../support/LogsPriceModels";

const props = withDefaults(
	defineProps<{
		/** 请求时冻结的单价快照。 */
		snapshot?: LogPriceSnapshot | undefined;
		/** 模型组名，仅用于气泡标题。 */
		model?: string;
		/** 事后补记标记；有值时气泡说明这一行不是请求时计费的结果。 */
		backfill?: PriceBackfill | undefined;
	}>(),
	{ snapshot: undefined, model: undefined, backfill: undefined },
);

const upstreamFields = computed(() => upstreamPriceFields(props.snapshot));
const rows = computed<readonly PriceSnapshotRow[]>(() => (props.snapshot === undefined ? [] : priceSnapshotRows(props.snapshot)));
const upstreamRows = computed(() => rows.value.filter((row) => row.fromUpstream));
const title = computed(() => props.model ?? "本次请求");
const upstream = computed(() => props.snapshot?.upstream);
</script>

<template>
	<UiPopover v-if="upstreamFields.length > 0 && snapshot" trigger="hover" placement="top" popup-class="logs-price-hint__popover">
		<button type="button" class="logs-price-hint__anchor" aria-label="查看本次请求的上游计费单价">
			<UiLucideIcon name="CircleDollarSign" :size="13" />
		</button>
		<template #content>
			<div class="logs-price-hint">
				<header class="logs-price-hint__header">
					<span class="logs-price-hint__title">{{ title }}</span>
					<span class="logs-price-hint__chip">{{ backfill ? "按上游价补记" : "本次按上游价计费" }}</span>
				</header>
				<p v-if="backfill" class="logs-price-hint__note">
					该行费用是按上游目录价事后补记的（原始请求发生在计费口径生效前），之后上游调价不会改变它。
				</p>
				<p v-else class="logs-price-hint__note">单价在请求发生时记录，之后上游调价不会改变这次费用。</p>
				<dl class="logs-price-hint__rows">
					<div v-for="row in rows" :key="row.field" class="logs-price-hint__row" :class="{ 'is-upstream': row.fromUpstream }">
						<dt>{{ row.label }}单价</dt>
						<dd>
							<span class="logs-price-hint__value">{{ row.perMillion }}<small>/1M</small></span
							><span class="logs-price-hint__source">{{ row.sourceLabel }}</span>
						</dd>
					</div>
				</dl>
				<footer v-if="upstream" class="logs-price-hint__footer">
					<span
						>上游 <code>{{ upstream.upstreamModel }}</code> · {{ upstream.source }}</span
					>
					<span>
						抓取于 {{ formatFreshness(upstream.fetchedAt) }}
						<span v-if="upstreamRows.length === 0" class="logs-price-hint__muted">（本次单价仍来自上游补位）</span>
					</span>
					<span v-if="snapshot.peak && snapshot.peak.multiplier !== 1" class="logs-price-hint__muted"
						>峰时 ×{{ snapshot.peak.multiplier }} 已计入费用</span
					>
				</footer>
			</div>
		</template>
	</UiPopover>
</template>

<style scoped>
.logs-price-hint__anchor {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 18px;
	height: 18px;
	padding: 0;
	border: none;
	border-radius: 4px;
	background: transparent;
	color: var(--color-success, #0f9d58);
	cursor: help;
	vertical-align: middle;
}
.logs-price-hint__anchor:hover,
.logs-price-hint__anchor:focus-visible {
	background: rgba(15, 157, 88, 0.12);
}
.logs-price-hint {
	min-width: 220px;
	max-width: 300px;
	font-size: 12px;
	line-height: 1.5;
}
.logs-price-hint__header {
	display: flex;
	align-items: baseline;
	gap: 8px;
	margin-bottom: 6px;
}
.logs-price-hint__title {
	font-weight: 600;
	color: var(--text-primary, #111827);
}
.logs-price-hint__chip {
	padding: 0 6px;
	border-radius: 999px;
	background: rgba(15, 157, 88, 0.12);
	color: var(--color-success, #0f9d58);
	font-size: 11px;
}
.logs-price-hint__note {
	margin: 0 0 8px;
	padding: 6px 8px;
	border-radius: 6px;
	background: #ecfdf5;
	color: #065f46;
	font-size: 12px;
}
.logs-price-hint__rows {
	display: grid;
	gap: 2px;
	margin: 0;
}
.logs-price-hint__row {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
	padding: 1px 4px;
	border-radius: 4px;
}
.logs-price-hint__row.is-upstream {
	background: var(--surface-subtle, rgba(15, 23, 42, 0.06));
}
.logs-price-hint__row dt {
	color: var(--text-secondary, #5b6270);
}
.logs-price-hint__row dd {
	display: flex;
	align-items: baseline;
	gap: 6px;
	margin: 0;
	color: var(--text-primary, #111827);
	font-variant-numeric: tabular-nums;
}
.logs-price-hint__value small {
	color: var(--text-tertiary, #9aa0aa);
}
.logs-price-hint__source {
	font-size: 11px;
	color: var(--text-tertiary, #9aa0aa);
}
.logs-price-hint__footer {
	display: grid;
	gap: 2px;
	margin-top: 8px;
	padding-top: 6px;
	border-top: 1px solid var(--border-subtle, rgba(15, 23, 42, 0.08));
	color: var(--text-tertiary, #9aa0aa);
	font-size: 11px;
}
.logs-price-hint__muted {
	color: var(--text-tertiary, #9aa0aa);
}
</style>
