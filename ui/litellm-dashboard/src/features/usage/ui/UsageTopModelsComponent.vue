<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UsageChart from "./charts/UsageChartComponent.vue";
import UsageChartLoader from "./UsageChartLoaderComponent.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import { cacheHitRate } from "../logic/UsageChartLogic";
import type { ModelRanking } from "../support/UsageModels";
const props = withDefaults(
	defineProps<{
		modelValue?: "groups" | "individual";
		groups: ModelRanking[];
		individual: ModelRanking[];
		loading: boolean;
		isDateChanging: boolean;
		dimension?: "spend" | "tokens";
		showModeToggle?: boolean;
	}>(),
	{ modelValue: undefined, dimension: "spend", showModeToggle: true },
);
const emit = defineEmits<{ "update:modelValue": [value: "groups" | "individual"] }>();
const localMode = ref<"groups" | "individual">("groups");
const mode = computed({
		get: () => props.modelValue ?? localMode.value,
		set: (value: "groups" | "individual") => {
			localMode.value = value;
			emit("update:modelValue", value);
		},
	}),
	money = useMoneyFormatter(),
	rows = computed(() => {
		const source = mode.value === "groups" ? props.groups : props.individual;
		const field = props.dimension === "tokens" ? "tokens" : "spend";
		return [...source].sort((a, b) => Number(b[field]) - Number(a[field]));
	}),
	title = computed(
		() =>
			`${mode.value === "groups" ? "Top Public Model Names" : "Top Litellm Models"} by ${props.dimension === "tokens" ? "Tokens" : "Spend"}`,
	),
	narrow = ref(false),
	displayRows = computed(() => rows.value.slice(0, narrow.value ? 5 : 10)),
	chartRows = computed(() => displayRows.value.map((row) => ({ ...row, label: modelLabel(row.key) })));
let media: MediaQueryList | undefined;
function syncNarrow(event?: MediaQueryListEvent) {
	narrow.value = event ? event.matches : Boolean(media?.matches);
}
onMounted(() => {
	if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
		media = window.matchMedia("(max-width: 767px)");
		syncNarrow();
		media.addEventListener("change", syncNarrow);
	}
});
onBeforeUnmount(() => media?.removeEventListener("change", syncNarrow));
function modelRow(row: Record<string, unknown>): ModelRanking {
	return row as unknown as ModelRanking;
}
/** 公共模型名可能带 provider 前缀；坐标轴只保留末端模型名并限制长度，完整名称留在 tooltip。 */
function modelLabel(key: string): string {
	const name = key.split("/").filter(Boolean).at(-1) ?? key;
	return name.length > 22 ? name.slice(0, 21) + "…" : name;
}
</script>
<template>
	<UiCard appearance="tremor" class="usage-panel">
		<header class="usage-panel-heading">
			<h2>{{ title }}</h2>
			<div v-if="showModeToggle" class="usage-segmented">
				<button :class="{ active: mode === 'groups' }" @click="mode = 'groups'">Public Name</button
				><button :class="{ active: mode === 'individual' }" @click="mode = 'individual'">Litellm Name</button>
			</div>
		</header>
		<UsageChartLoader v-if="loading" :is-date-changing="isDateChanging" />
		<div v-else>
			<UsageChart
				v-if="chartRows.length"
				:data="chartRows as unknown as Record<string, unknown>[]"
				index="label"
				:categories="[dimension]"
				:colors="[dimension === 'tokens' ? 'indigo' : 'cyan']"
				:height="320"
				:y-axis-width="64"
				:x-axis-label-angle="70"
				:format="
					dimension === 'tokens'
						? (v) => (v >= 1e9 ? formatNumberWithCommas(v, 1, true) : formatNumberWithCommas(v, 0, true))
						: (v) => money(v, 'compact')
				"
			>
				<template #tooltip="{ row }"
					><ModelName class="usage-tooltip-model" :model="String(row.key)" :size="14" variant="strong" />
					<p class="usage-cyan">Spend: {{ money(Number(row.spend), 2, String(row.key)) }}</p>
					<p>Total Requests: {{ Number(row.requests).toLocaleString() }}</p>
					<p class="usage-success">Successful: {{ Number(row.successful_requests).toLocaleString() }}</p>
					<p class="usage-failed">Failed: {{ Number(row.failed_requests).toLocaleString() }}</p>
					<p>Tokens: {{ formatNumberWithCommas(Number(row.tokens), 0, false) }}</p>
					<p>
						Input Cache Hit:
						{{
							cacheHitRate(
								Number(modelRow(row).metrics.cache_read_input_tokens),
								Number(modelRow(row).metrics.prompt_tokens),
							)
						}}%
					</p></template
				>
			</UsageChart>
		</div>
	</UiCard>
</template>
