<script setup lang="ts">
import { computed, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UsageChart from "./charts/UsageChartComponent.vue";
import UsageLegend from "./charts/UsageLegendComponent.vue";
import UsageActivitySection from "./UsageActivitySectionComponent.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { overallActivity } from "../logic/UsageSummaryLogic";
import { tokenChartFields, usageTokenBreakdown } from "../logic/UsageTokenLogic";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import type { ModelActivityData } from "../support/UsageModels";
const props = defineProps<{ modelMetrics: Record<string, ModelActivityData>; hidePromptCachingMetrics?: boolean }>();
const money = useMoneyFormatter(),
	number = (n: number) => formatNumberWithCommas(n, 0, false);
const names = computed(() =>
	Object.keys(props.modelMetrics).sort((a, b) =>
		a === "" ? 1 : b === "" ? -1 : props.modelMetrics[b].total_spend - props.modelMetrics[a].total_spend,
	),
);
const open = ref(new Set(names.value.length ? [names.value[0]] : [])),
	visited = ref(new Set(open.value));
const total = computed(() => overallActivity(props.modelMetrics)),
	tokens = computed(() =>
		usageTokenBreakdown({
			prompt_tokens: total.value.total_prompt_tokens,
			completion_tokens: total.value.total_completion_tokens,
			total_tokens: total.value.total_tokens,
			cache_read_input_tokens: total.value.total_cache_read_input_tokens,
			cache_creation_input_tokens: total.value.total_cache_creation_input_tokens,
		}),
	),
	tokenDays = computed(() => total.value.daily_data.map((row) => ({ date: row.date, ...tokenChartFields(row.metrics) })));
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
						:format="(v) => v.toLocaleString()"
				/></UiCard>
			</div>
		</div>
		<div class="usage-collapse">
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
		</div>
	</div>
</template>
