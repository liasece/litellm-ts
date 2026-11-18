<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UsageChart from "./charts/UsageChartComponent.vue";
import UsageLegend from "./charts/UsageLegendComponent.vue";
import UsageActivitySection from "./UsageActivitySectionComponent.vue";
import UsageActivityTrends from "./UsageActivityTrendsComponent.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { overallActivity } from "../logic/UsageSummaryLogic";
import { tokenChartFields, usageTokenBreakdown } from "../logic/UsageTokenLogic";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import type { ModelActivityData, SpendMetrics } from "../support/UsageModels";
import type { ActivityOverall, ActivityTopEntity } from "../logic/UsageOverviewLogic";
import type { ActivitySeries } from "../logic/UsageSeriesLogic";
type ActivityEntityKind = "model" | "key" | "mcp" | "agent";
const props = withDefaults(
	defineProps<{
		modelMetrics: Record<string, ModelActivityData>;
		hidePromptCachingMetrics?: boolean;
		/** 当前 Tab 的实体类型，只用于顶部 Token 排行的标题和模型名压缩。 */
		entityKind?: ActivityEntityKind;
		loading?: boolean;
		hasMore?: boolean;
		loadingMore?: boolean;
		overall?: ActivityOverall | null;
		topEntities?: ActivityTopEntity[];
		/** 顶部随时间的 Token/花费堆叠图；Model/Key/MCP 由页面提供，Endpoint 走 UsageEndpoint。 */
		series?: ActivitySeries | null;
	}>(),
	{
		hidePromptCachingMetrics: false,
		entityKind: "model",
		loading: false,
		hasMore: false,
		loadingMore: false,
		overall: null,
		topEntities: () => [],
		series: null,
	},
);
const emit = defineEmits<{ loadMore: [] }>();
const money = useMoneyFormatter(),
	number = (n: number) => formatNumberWithCommas(n, 0, false);
/** 趋势组件与 Activity 的实体类型一致，直接传下去，避免两处各自维护映射。 */
const trendKind = computed(() => props.entityKind);
const names = computed(() =>
	Object.keys(props.modelMetrics).sort((a, b) =>
		a === "" ? 1 : b === "" ? -1 : props.modelMetrics[b].total_spend - props.modelMetrics[a].total_spend,
	),
);
const open = ref(new Set(names.value.length ? [names.value[0]] : [])),
	visited = ref(new Set(open.value));
// Activity 在 Tab 首次挂载时可能还没拿到 detail；数据到达后自动展开花费最高的实体。
watch(names, (value) => {
	if (open.value.size || !value.length) return;
	open.value = new Set([value[0]]);
	visited.value = new Set([value[0]]);
});
const total = computed(() => props.overall ?? overallActivity(props.modelMetrics)),
	tokens = computed(() =>
		usageTokenBreakdown({
			prompt_tokens: total.value.total_prompt_tokens,
			completion_tokens: total.value.total_completion_tokens,
			total_tokens: total.value.total_tokens,
			cache_read_input_tokens: total.value.total_cache_read_input_tokens,
			cache_creation_input_tokens: total.value.total_cache_creation_input_tokens,
		}),
	),
	tokenDays = computed(() => total.value.daily_data.map((row) => ({ date: row.date, ...tokenChartFields(row.metrics) }))),
	narrow = ref(false),
	topTitle = computed(
		() =>
			({
				model: "Top Models by Tokens",
				key: "Top Virtual Keys by Tokens",
				mcp: "Top MCP Servers by Tokens",
				agent: "Top Agents by Tokens",
			})[props.entityKind],
	),
	topRows = computed(() => {
		const source = props.topEntities.length
			? props.topEntities.map((item) => ({ ...item, fullLabel: item.label }))
			: Object.entries(props.modelMetrics).map(([key, data]) => ({
					key,
					fullLabel: data.label || key || "Unknown Item",
					tokens: data.total_tokens,
					spend: data.total_spend,
					requests: data.total_requests,
				}));
		return source
			.map((row) => ({ ...row, label: compactEntityLabel(row.fullLabel) }))
			.filter((row) => row.tokens > 0)
			.sort((a, b) => b.tokens - a.tokens)
			.slice(0, narrow.value ? 5 : 10);
	});
let media: MediaQueryList | undefined;
function syncNarrow(event?: MediaQueryListEvent) {
	narrow.value = event ? event.matches : Boolean(media?.matches);
}
onMounted(() => {
	if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
		media = window.matchMedia("(max-width: 1279px)");
		syncNarrow();
		media.addEventListener("change", syncNarrow);
	}
});
onBeforeUnmount(() => media?.removeEventListener("change", syncNarrow));
/** 模型名可能带 provider 前缀；轴标签只保留末端名称，实体名直接截断。 */
function compactEntityLabel(value: string): string {
	let label = value;
	if (props.entityKind === "model") {
		const parts = value.split("/").filter(Boolean);
		// 取真正的 provider 段（三层路径取第二段）+ 模型名；超长时保留模型名末尾，避免同名变体互相覆盖。
		if (parts.length > 1) {
			const provider = (parts.length >= 3 ? parts[1] : parts[0]).slice(0, 11);
			const model = parts.at(-1)!;
			const full = `${provider}/${model}`;
			label = full.length <= 22 ? full : `${provider}/…${model.slice(-9)}`;
		}
	}
	return label.length > 22 ? label.slice(0, 21) + "…" : label;
}
function tokenRow(row: Record<string, unknown>): { fullLabel: string; tokens: number; spend: number; requests: number } {
	return row as unknown as { fullLabel: string; tokens: number; spend: number; requests: number };
}
function dailyRow(row: Record<string, unknown>): { date: string; metrics: SpendMetrics } {
	return row as unknown as { date: string; metrics: SpendMetrics };
}
function toggle(name: string) {
	const next = new Set(open.value);
	if (next.has(name)) next.delete(name);
	else {
		next.add(name);
		visited.value.add(name);
	}
	open.value = next;
}
</script>
<template>
	<div class="usage-activity">
		<UsageActivityTrends v-if="series && !loading" :series="series" :entity-kind="trendKind" />
		<div class="usage-overall">
			<h2>Overall Usage</h2>
			<div class="usage-grid-four">
				<UiCard appearance="tremor"
					><p>Total Requests</p>
					<h2>{{ total.total_requests.toLocaleString() }}</h2></UiCard
				><UiCard appearance="tremor"
					><p>Total Successful Requests</p>
					<h2>{{ total.total_successful_requests.toLocaleString() }}</h2></UiCard
				><UiCard appearance="tremor"
					><p>Total Tokens</p>
					<h2>{{ number(total.total_tokens) }}</h2>
					<p>{{ tokens.hitRate }}% cache hit rate</p></UiCard
				><UiCard appearance="tremor"
					><p>Total Spend</p>
					<h2>{{ money(total.total_spend, 2) }}</h2></UiCard
				>
			</div>
			<div class="usage-grid-two">
				<UiCard appearance="tremor"
					><header>
						<h2>Token Usage Over Time</h2>
						<UsageLegend
							:categories="['input', 'output', 'cache_read', 'hit_rate']"
							:colors="['blue', 'cyan', 'emerald', 'amber']"
							:dashed="[false, false, false, true]"
						/>
					</header>
					<UsageChart
						:data="tokenDays"
						index="date"
						:categories="['input', 'output', 'cache_read']"
						:colors="['blue', 'cyan', 'emerald']"
						kind="area"
						:y-axis-width="104"
						:secondary-categories="['hit_rate']"
						:height="240"
						:format="number" /></UiCard
				><UiCard appearance="tremor"
					><header>
						<h2>Total Requests Over Time</h2>
						<UsageLegend
							:categories="['metrics.successful_requests', 'metrics.failed_requests']"
							:colors="['emerald', 'red']"
						/>
					</header>
					<UsageChart
						:data="total.daily_data"
						index="date"
						:categories="['metrics.successful_requests', 'metrics.failed_requests']"
						:colors="['emerald', 'red']"
						kind="area"
						:height="240"
						:format="(v) => v.toLocaleString()"
				/></UiCard>
				<UiCard appearance="tremor"
					><header>
						<h2>Daily Tokens</h2>
						<UsageLegend :categories="['metrics.total_tokens']" :colors="['indigo']" />
					</header>
					<UsageChart
						:data="total.daily_data"
						index="date"
						:categories="['metrics.total_tokens']"
						:colors="['indigo']"
						:height="320"
						:y-axis-width="80"
						:format="(v) => (v >= 1e9 ? formatNumberWithCommas(v, 1, true) : formatNumberWithCommas(v, 0, true))"
					>
						<template #tooltip="{ row }"
							><b>{{ dailyRow(row).date }}</b>
							<p>Tokens: {{ number(dailyRow(row).metrics.total_tokens) }}</p>
							<p>Requests: {{ dailyRow(row).metrics.api_requests.toLocaleString() }}</p>
							<p>Spend: {{ money(dailyRow(row).metrics.spend, 2) }}</p></template
						>
					</UsageChart></UiCard
				>
				<UiCard appearance="tremor"
					><h2>{{ topTitle }}</h2>
					<UsageChart
						v-if="topRows.length"
						:data="topRows as unknown as Record<string, unknown>[]"
						index="label"
						:categories="['tokens']"
						:colors="['indigo']"
						:height="320"
						:y-axis-width="64"
						:x-axis-label-angle="70"
						:format="(v) => (v >= 1e9 ? formatNumberWithCommas(v, 1, true) : formatNumberWithCommas(v, 0, true))"
					>
						<template #tooltip="{ row }"
							><b>{{ tokenRow(row).fullLabel }}</b>
							<p>Tokens: {{ number(tokenRow(row).tokens) }}</p>
							<p>Spend: {{ money(tokenRow(row).spend, 2) }}</p>
							<p>Requests: {{ tokenRow(row).requests.toLocaleString() }}</p></template
						>
					</UsageChart>
					<p v-else class="usage-empty">No token usage</p></UiCard
				>
			</div>
		</div>
		<div v-if="loading && !names.length" class="usage-empty">Loading usage details…</div>
		<div v-else class="usage-collapse">
			<section v-for="name in names" :key="name">
				<button :aria-expanded="open.has(name)" @click="toggle(name)">
					<UiIcon :name="open.has(name) ? 'DownOutlined' : 'RightOutlined'" :size="12" /><span
						><h2 class="usage-activity-model">
							<ModelName :model="name" :name="modelMetrics[name].label || 'Unknown Item'" :size="16" />
						</h2>
						<span
							>{{ money(modelMetrics[name].total_spend, 2, name)
							}}<span>{{ modelMetrics[name].total_requests.toLocaleString() }} requests</span></span
						></span
					>
				</button>
				<div v-if="visited.has(name)" v-show="open.has(name)" class="usage-collapse-body">
					<UsageActivitySection :metrics="modelMetrics[name]" :hide-prompt-caching-metrics="hidePromptCachingMetrics" />
				</div>
			</section>
			<div v-if="hasMore" class="usage-load-more">
				<UiButton :loading="loadingMore" :disabled="loadingMore" @click="emit('loadMore')">{{
					loadingMore ? "Loading…" : "Load more"
				}}</UiButton>
			</div>
		</div>
	</div>
</template>
