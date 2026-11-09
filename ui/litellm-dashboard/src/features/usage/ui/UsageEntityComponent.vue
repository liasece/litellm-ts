<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import type { UiTableColumn, UiTableRow } from "../../platform/ui/UiTypes";
import ProviderLogo from "../../providers/ui/ProviderLogoComponent.vue";
import { getProviderLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
import { useApplicationStore } from "../../application/stores/ApplicationStore";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import { createDailyActivityStore } from "../stores/DailyActivityStore";
import { modelRankings, providerRankings, keyRankings } from "../logic/UsageSummaryLogic";
import { processActivityData } from "../logic/ActivityMetricsLogic";
import { agentRankings, entityBreakdown, entityLabel } from "../logic/EntityUsageLogic";
import type { DateRangeValue } from "../../date-range/support/DateRangeModels";
import type { EntityType, EntityOption, DailyData } from "../support/UsageModels";
import UsageChart from "./charts/UsageChartComponent.vue";
import UsageActivity from "./UsageActivityComponent.vue";
import UsageEndpoint from "./UsageEndpointComponent.vue";
import UsageProgress from "./UsageProgressComponent.vue";
import UsageTopKeys from "./UsageTopKeysComponent.vue";
import UsageModelTable from "./UsageModelTableComponent.vue";
import UsageExport from "./UsageExportDialogComponent.vue";
const props = defineProps<{ entityType: EntityType; options: EntityOption[]; dateRange: DateRangeValue }>();
const selected = ref<string[]>([]),
	tab = ref("cost"),
	exportOpen = ref(false),
	app = useApplicationStore(),
	money = useMoneyFormatter();
const store = createDailyActivityStore(),
	agentStore = createDailyActivityStore(),
	{ state } = store,
	agent = agentStore.state;
const title = computed(() => props.entityType.charAt(0).toUpperCase() + props.entityType.slice(1));
watch(
	() => [props.dateRange.from?.getTime(), props.dateRange.to?.getTime(), props.entityType, JSON.stringify(selected.value)],
	() => {
		const from = props.dateRange.from,
			to = props.dateRange.to;
		if (from && to) void store.load({ entity: props.entityType, from, to, selected: selected.value }, false);
	},
	{ immediate: true },
);
watch(
	() => [props.dateRange.from?.getTime(), props.dateRange.to?.getTime(), props.entityType],
	() => {
		const from = props.dateRange.from,
			to = props.dateRange.to;
		if (from && to && props.entityType === "team") void agentStore.load({ entity: "agent", from, to, selected: [] }, false);
		else agentStore.reset();
	},
	{ immediate: true },
);
onBeforeUnmount(() => {
	store.dispose();
	agentStore.dispose();
});
const tabs = computed(() => [
	{ key: "cost", label: "Cost" },
	{ key: "models", label: props.entityType === "agent" ? "Request / Token Consumption" : "Model Activity" },
	...(props.entityType === "team" ? [{ key: "agents", label: "Agent Activity" }] : []),
	{ key: "keys", label: "Key Activity" },
	{ key: "endpoints", label: "Endpoint Activity" },
]);
type EntityUsage = ReturnType<typeof entityBreakdown>[number];
const entityRow = (row: unknown) => row as EntityUsage;
const entities = computed(() => entityBreakdown(state.data, props.options, selected.value)),
	providers = computed(() =>
		providerRankings(state.data)
			.filter((p) => p.spend > 0)
			.sort((a, b) => b.spend - a.spend),
	);
const modelMetrics = computed(() => processActivityData(state.data, "models", app.state.teams)),
	keyMetrics = computed(() => processActivityData(state.data, "api_keys", app.state.teams)),
	agentMetrics = computed(() => processActivityData(agent.data, "entities", app.state.teams));
const models = computed(() => modelRankings(state.data)),
	agents = computed(() => agentRankings(agent.data)),
	keys = computed(() => keyRankings(state.data, true));
type ProviderUsage = ReturnType<typeof providerRankings>[number];
const providerRow = (row: UiTableRow) => row as unknown as ProviderUsage;
const entityColumns = computed<readonly UiTableColumn[]>(() => [
	{ key: "alias", label: title.value, width: 160 },
	{ key: "spend", label: "Spend", width: 90 },
	{ key: "successful", label: "Successful", width: 100, cellClass: "usage-success" },
	{ key: "failed", label: "Failed", width: 80, cellClass: "usage-failed" },
	{ key: "tokens", label: "Tokens", width: 100 },
]);
const entityRows = computed<readonly UiTableRow[]>(
	() => entities.value.filter((item) => item.metrics.spend > 0) as unknown as readonly UiTableRow[],
);
const providerColumns: readonly UiTableColumn[] = [
	{ key: "provider", label: "Provider", width: 150 },
	{ key: "spend", label: "Spend", width: 90 },
	{ key: "successful_requests", label: "Successful", width: 100, cellClass: "usage-success" },
	{ key: "failed_requests", label: "Failed", width: 80, cellClass: "usage-failed" },
	{ key: "tokens", label: "Tokens", width: 100 },
];
const providerRows = computed<readonly UiTableRow[]>(() => providers.value as unknown as readonly UiTableRow[]);
const days = computed(() => [...state.data.results].sort((a, b) => a.date.localeCompare(b.date)));
const metrics = computed(() => [
	{ label: "Total Spend", value: money(state.data.metadata.total_spend, 2) },
	{ label: "Total Requests", value: state.data.metadata.total_api_requests.toLocaleString() },
	{ label: "Successful Requests", value: state.data.metadata.total_successful_requests.toLocaleString(), color: "#16a34a" },
	{ label: "Failed Requests", value: state.data.metadata.total_failed_requests.toLocaleString(), color: "#dc2626" },
	{ label: "Total Tokens", value: formatNumberWithCommas(state.data.metadata.total_tokens, 0, false) },
]);
function daily(row: Record<string, unknown>): DailyData {
	return row as unknown as DailyData;
}
function tooltipEntities(row: Record<string, unknown>) {
	return Object.entries(daily(row).breakdown.entities)
		.sort(([, a], [, b]) => b.metrics.spend - a.metrics.spend)
		.slice(0, 5);
}
function changeSelection(value: unknown) {
	selected.value = Array.isArray(value) ? value.map(String) : value == null ? [] : [String(value)];
}
</script>
<template>
	<div class="usage-entity">
		<UsageProgress :fetching="state.isFetchingMore" :cancelled="state.cancelled" :progress="state.progress" @cancel="store.cancel" />
		<UsageProgress
			v-if="entityType === 'team'"
			:fetching="agent.isFetchingMore"
			:cancelled="agent.cancelled"
			:progress="agent.progress"
			agent
			@cancel="agentStore.cancel"
		/>
		<div class="usage-entity-toolbar" :class="{ 'usage-entity-toolbar--filters': options.length > 0 }">
			<div v-if="options.length">
				<p>Filter by {{ entityType }}</p>
				<UiSelect
					:model-value="entityType === 'user' ? (selected[0] ?? null) : selected"
					:options="options"
					:multiple="entityType !== 'user'"
					clearable
					:placeholder="'Select ' + entityType + ' to filter...'"
					@update:model-value="changeSelection"
				/>
			</div>
			<UiButton appearance="tremor" variant="primary" @click="exportOpen = true"
				><template #icon
					><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
						/></svg></template
				>Export Data</UiButton
			>
		</div>
		<UiTabs v-model="tab" :items="tabs" appearance="tremor" class="usage-solid-tabs" />
		<div v-show="tab === 'cost'" class="usage-entity-cost">
			<UiCard appearance="tremor" class="usage-entity-wide"
				><h2>{{ title }} Spend Overview</h2>
				<div class="usage-grid-five">
					<UiCard v-for="metric in metrics" :key="metric.label" appearance="tremor"
						><h2>{{ metric.label }}</h2>
						<p :style="{ color: metric.color }">{{ metric.value }}</p></UiCard
					>
				</div></UiCard
			>
			<UiCard appearance="tremor" class="usage-entity-wide"
				><h2>Daily Spend</h2>
				<UsageChart
					:data="days"
					index="date"
					:categories="['metrics.spend']"
					:y-axis-width="100"
					:format="(v) => money(v, 'compact')"
					><template #tooltip="{ row }"
						><b>{{ row.date }}</b>
						<p class="usage-cyan">Total Spend: {{ money(Number(daily(row).metrics.spend), 2) }}</p>
						<p>Total Requests: {{ daily(row).metrics.api_requests }}</p>
						<p>Successful: {{ daily(row).metrics.successful_requests }}</p>
						<p>Failed: {{ daily(row).metrics.failed_requests }}</p>
						<p>Total Tokens: {{ formatNumberWithCommas(Number(daily(row).metrics.total_tokens), 0, false) }}</p>
						<p>Total {{ title }}s: {{ Object.keys(daily(row).breakdown.entities).length }}</p>
						<div class="usage-entity-tooltip-items">
							<b>Spend by {{ title }}:</b>
							<p v-for="[id, item] in tooltipEntities(row)" :key="id">
								{{ entityLabel(id, item.metadata, options) }}: {{ money(item.metrics.spend, 2) }}
							</p>
							<i v-if="Object.keys(daily(row).breakdown.entities).length > 5"
								>...and {{ Object.keys(daily(row).breakdown.entities).length - 5 }} more</i
							>
						</div></template
					></UsageChart
				></UiCard
			>
			<UiCard appearance="tremor" class="usage-entity-wide"
				><div class="usage-spend-per-entity">
					<div>
						<h2>Spend Per {{ title }}</h2>
						<p>Showing Top 5 by Spend</p>
						<p>
							Get Started by Tracking cost per {{ title }}
							<a href="https://docs.litellm.ai/docs/proxy/enterprise#spend-tracking">here</a>
						</p>
					</div>
					<div class="usage-grid-two">
						<UsageChart
							:data="entities.slice(0, 5)"
							index="metadata.alias_display"
							:categories="['metrics.spend']"
							horizontal
							:height="208"
							:y-axis-width="150"
							:format="(v) => money(v, 'compact')"
						>
							<template #tooltip="{ row }"
								><b>{{ entityRow(row).metadata.alias }}</b>
								<p class="usage-cyan">Spend: {{ money(entityRow(row).metrics.spend, 4) }}</p>
								<p>Requests: {{ entityRow(row).metrics.api_requests.toLocaleString() }}</p>
								<p class="usage-success">Successful: {{ entityRow(row).metrics.successful_requests.toLocaleString() }}</p>
								<p class="usage-failed">Failed: {{ entityRow(row).metrics.failed_requests.toLocaleString() }}</p>
								<p>Tokens: {{ formatNumberWithCommas(entityRow(row).metrics.total_tokens, 0, false) }}</p>
							</template>
						</UsageChart>
						<div class="usage-entity-breakdown-table">
							<UiTable
								:columns="entityColumns"
								:rows="entityRows"
								:row-key="(row) => String(entityRow(row).metadata.id)"
								fixed-layout
								sticky-header
								:body-max-height="176"
								empty-text="No logs found"
							>
								<template #cell-alias="{ row }">{{ entityRow(row).metadata.alias }}</template>
								<template #cell-spend="{ row }">{{ money(entityRow(row).metrics.spend, 4) }}</template>
								<template #cell-successful="{ row }">{{
									entityRow(row).metrics.successful_requests.toLocaleString()
								}}</template>
								<template #cell-failed="{ row }">{{ entityRow(row).metrics.failed_requests.toLocaleString() }}</template>
								<template #cell-tokens="{ row }">{{
									formatNumberWithCommas(entityRow(row).metrics.total_tokens, 0, false)
								}}</template>
							</UiTable>
						</div>
					</div>
				</div></UiCard
			>
			<UiCard appearance="tremor"
				><h2>Top Virtual Keys</h2>
				<UsageTopKeys :rows="keys" :show-tags="entityType === 'tag'"
			/></UiCard>
			<UiCard appearance="tremor"
				><h2>{{ entityType === "agent" ? "Top Agents" : "Top Models" }}</h2>
				<UsageModelTable :rows="models"
			/></UiCard>
			<UiCard v-if="entityType === 'team'" appearance="tremor" class="usage-entity-wide"
				><h2>Top Agents Driving Spend</h2>
				<UsageModelTable :rows="agents"
			/></UiCard>
			<UiCard appearance="tremor" class="usage-entity-wide"
				><h2>Provider Usage</h2>
				<div class="usage-grid-two usage-entity-providers">
					<UsageChart
						:data="providers as unknown as Record<string, unknown>[]"
						index="provider"
						:categories="['spend']"
						:colors="['cyan', 'blue', 'indigo', 'violet', 'purple']"
						kind="donut"
						:height="160"
						:format="(v) => money(v, 2)"
					/>
					<UiTable :columns="providerColumns" :rows="providerRows" row-key="provider" fixed-layout empty-text="No logs found">
						<template #cell-provider="{ row }">
							<span class="usage-provider-name"
								><ProviderLogo
									v-if="providerRow(row).provider"
									:provider="providerRow(row).provider"
									:logo="getProviderLogoAndName(providerRow(row).provider).logo"
								/>{{ providerRow(row).provider }}</span
							>
						</template>
						<template #cell-spend="{ row }">{{ money(providerRow(row).spend, 2) }}</template>
						<template #cell-successful_requests="{ row }">{{ providerRow(row).successful_requests.toLocaleString() }}</template>
						<template #cell-failed_requests="{ row }">{{ providerRow(row).failed_requests.toLocaleString() }}</template>
						<template #cell-tokens="{ row }">{{ formatNumberWithCommas(providerRow(row).tokens, 0, false) }}</template>
					</UiTable>
				</div></UiCard
			>
		</div>
		<UsageActivity v-show="tab === 'models'" :model-metrics="modelMetrics" :hide-prompt-caching-metrics="entityType === 'agent'" />
		<UsageActivity v-if="entityType === 'team'" v-show="tab === 'agents'" :model-metrics="agentMetrics" />
		<UsageActivity v-show="tab === 'keys'" :model-metrics="keyMetrics" :hide-prompt-caching-metrics="entityType === 'agent'" />
		<UsageEndpoint v-show="tab === 'endpoints'" :data="state.data" />
		<UsageExport
			v-model:open="exportOpen"
			:entity-type="entityType"
			:data="state.data"
			:date-range="dateRange"
			:selected-filters="selected"
		/>
	</div>
</template>
