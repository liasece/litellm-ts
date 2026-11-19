<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UsageActivitySection from "./UsageActivitySectionComponent.vue";
import UsageActivityTrends from "./UsageActivityTrendsComponent.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import type { ModelActivityData } from "../support/UsageModels";
import type { ActivitySeries } from "../logic/UsageSeriesLogic";
type ActivityEntityKind = "model" | "key" | "agent";
const props = withDefaults(
	defineProps<{
		modelMetrics: Record<string, ModelActivityData>;
		hidePromptCachingMetrics?: boolean;
		/** 分区里的实体类型，只用于趋势区的文案。 */
		entityKind?: ActivityEntityKind;
		loading?: boolean;
		hasMore?: boolean;
		loadingMore?: boolean;
		/** 顶部随时间的 Token/花费堆叠图；Model/Key 由页面提供，Endpoint 走 UsageEndpoint。 */
		series?: ActivitySeries | null;
	}>(),
	{
		hidePromptCachingMetrics: false,
		entityKind: "model",
		loading: false,
		hasMore: false,
		loadingMore: false,
		series: null,
	},
);
const emit = defineEmits<{ loadMore: [] }>();
const money = useMoneyFormatter();
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
