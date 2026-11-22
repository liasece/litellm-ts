<script setup lang="ts">
import { computed, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UsageActivitySection from "./UsageActivitySectionComponent.vue";
import UsageActivityTrends from "./UsageActivityTrendsComponent.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import type { ModelActivityData } from "../support/UsageModels";
import type { ActivitySeries } from "../logic/UsageSeriesLogic";
type ActivityEntityKind = "model" | "key" | "agent" | "account";
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
		/** 所选范围内每一天，趋势图据此补齐无数据的日子。 */
		dates?: string[];
	}>(),
	{
		hidePromptCachingMetrics: false,
		entityKind: "model",
		loading: false,
		hasMore: false,
		loadingMore: false,
		series: null,
		dates: () => [],
	},
);
const emit = defineEmits<{ loadMore: [] }>();
const money = useMoneyFormatter();
const ACCOUNT_KIND_LABELS: Readonly<Record<string, string>> = {
	subscription: "Subscription",
	credential: "Credential",
	unassociated: "Inline key",
	unattributed: "Not recorded",
};
function accountKindLabel(kind: string | undefined): string {
	return kind === undefined ? "Account" : (ACCOUNT_KIND_LABELS[kind] ?? kind);
}
/** 趋势组件与 Activity 的实体类型一致，直接传下去，避免两处各自维护映射。 */
const trendKind = computed(() => props.entityKind);
const names = computed(() =>
	Object.keys(props.modelMetrics).sort((a, b) =>
		a === "" ? 1 : b === "" ? -1 : props.modelMetrics[b].total_spend - props.modelMetrics[a].total_spend,
	),
);
/**
 * 默认全部收起：用户想看哪个实体并不确定，自动展开花费最高的那个会让人一进页面就被推着往下读，
 * 也会在切 Tab 时把滚动位置带走。展开过的实体才挂载图表（`visited`），收起不销毁。
 */
const open = ref(new Set<string>()),
	visited = ref(new Set<string>());
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
		<UsageActivityTrends v-if="series && !loading" :series="series" :entity-kind="trendKind" :dates="dates" />
		<div v-if="loading && !names.length" class="usage-empty">Loading usage details…</div>
		<div v-else class="usage-collapse">
			<section v-for="name in names" :key="name">
				<button :aria-expanded="open.has(name)" @click="toggle(name)">
					<UiIcon :name="open.has(name) ? 'DownOutlined' : 'RightOutlined'" :size="12" /><span
						><h2 class="usage-activity-model">
							<ModelName
								v-if="entityKind !== 'account'"
								:model="name"
								:name="modelMetrics[name].label || 'Unknown Item'"
								:size="16"
							/>
							<span v-else>{{ modelMetrics[name].label || "Unknown Account" }}</span>
						</h2>
						<span v-if="entityKind === 'account'" class="usage-account-meta">
							<span
								class="usage-account-badge"
								:class="'usage-account-badge--' + (modelMetrics[name].accountKind || 'unattributed')"
								>{{ accountKindLabel(modelMetrics[name].accountKind) }}</span
							>
							<span
								v-if="
									modelMetrics[name].provider &&
									(modelMetrics[name].accountKind !== 'subscription' || modelMetrics[name].provider === 'multiple')
								"
								class="usage-account-provider"
								>{{ modelMetrics[name].provider }}</span
							>
							<span v-if="(modelMetrics[name].keyCount ?? 0) > 0" class="usage-account-keys">
								{{ modelMetrics[name].keyCount }} {{ modelMetrics[name].keyCount === 1 ? "key" : "keys" }}
							</span>
							<span v-if="modelMetrics[name].trashed" class="usage-account-warning">Trashed</span>
							<span v-if="modelMetrics[name].deleted" class="usage-account-warning">Deleted</span>
						</span>
						<span
							>{{ money(modelMetrics[name].total_spend, 2, name)
							}}<span>{{ modelMetrics[name].total_requests.toLocaleString() }} requests</span></span
						></span
					>
				</button>
				<div v-if="visited.has(name)" v-show="open.has(name)" class="usage-collapse-body">
					<UsageActivitySection
						:metrics="modelMetrics[name]"
						:hide-prompt-caching-metrics="hidePromptCachingMetrics"
						:dates="dates"
					/>
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
