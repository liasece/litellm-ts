<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { isAdminRole } from "../../identity/logic/UserRoleLogic";
import { useApplicationStore } from "../../application/stores/ApplicationStore";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import AdvancedDatePicker from "../../date-range/ui/AdvancedDatePickerComponent.vue";
import type { DateRangeValue } from "../../date-range/support/DateRangeModels";
import type { DailyData, EntityOption, UsageView } from "../support/UsageModels";
import { createDailyActivityStore } from "../stores/DailyActivityStore";
import { createUsageCatalogStore } from "../stores/UsageCatalogStore";
import { dateRangeLabel, keyRankings, modelRankings, providerRankings } from "../logic/UsageSummaryLogic";
import { processActivityData } from "../logic/ActivityMetricsLogic";
import UsageChart from "./charts/UsageChartComponent.vue";
import UsageChartLoader from "./UsageChartLoaderComponent.vue";
import UsageMetrics from "./UsageMetricsCardsComponent.vue";
import UsageTopModels from "./UsageTopModelsComponent.vue";
import UsageProviderSpend from "./UsageProviderSpendComponent.vue";
import UsageTopKeys from "./UsageTopKeysComponent.vue";
import UsageActivity from "./UsageActivityComponent.vue";
import UsageEndpoint from "./UsageEndpointComponent.vue";
import UsageEntity from "./UsageEntityComponent.vue";
import UsageProgress from "./UsageProgressComponent.vue";
import UsageExport from "./UsageExportDialogComponent.vue";
import UsageAiPanel from "./UsageAiPanelComponent.vue";
import UsageUserAgent from "./UsageUserAgentComponent.vue";
import UsageUpstreamQuota from "./UsageUpstreamQuotaComponent.vue";
import "./UsageStyles.css";
import "../styles/UsageAuxiliaryStyles.css";
const auth = useAuthenticationStore(),
	app = useApplicationStore(),
	money = useMoneyFormatter();
const admin = computed(() => isAdminRole(auth.userRole.value));
const date = ref<DateRangeValue>({ from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), to: new Date() });
const view = ref<UsageView>("global"),
	tab = ref("cost"),
	selectedUser = ref<string | null>(admin.value ? null : (auth.state.session?.user_id ?? null));
const modelMode = ref<"groups" | "individual">("groups"),
	tokenBreakdown = ref(false),
	banner = ref(true),
	exportOpen = ref(false),
	aiOpen = ref(false),
	dateChanging = ref(false);
const store = createDailyActivityStore(),
	catalog = createUsageCatalogStore(),
	{ state } = store,
	lists = catalog.state;
const effectiveUser = computed(() => (admin.value ? selectedUser.value : (auth.state.session?.user_id ?? null)));
watch(
	() => [date.value.from?.getTime(), date.value.to?.getTime(), effectiveUser.value, Boolean(auth.state.session)],
	async () => {
		const from = date.value.from,
			to = date.value.to;
		if (!from || !to || !auth.state.session) {
			store.reset();
			return;
		}
		await store.load({ entity: "global", from, to, selected: effectiveUser.value ? [effectiveUser.value] : [] });
		if (!state.loading) dateChanging.value = false;
	},
	{ immediate: true },
);
watch(
	() => [admin.value, auth.state.session?.user_id],
	() => {
		if (!admin.value && auth.state.session?.user_id) selectedUser.value = auth.state.session.user_id;
	},
	{ immediate: true },
);
void catalog.initialize(admin.value);
watch(view, () => {
	tab.value = "cost";
});
onBeforeUnmount(() => {
	store.dispose();
	catalog.dispose();
});
const viewOptions = computed(() => [
	{
		value: "global",
		label: admin.value ? "Global Usage" : "Your Usage",
		description: admin.value ? "View usage across all resources" : "View your usage",
		icon: "GlobalOutlined",
	},
	{
		value: "organization",
		label: admin.value ? "Organization Usage" : "Your Organization Usage",
		description: admin.value ? "View usage across all organizations" : "View your organization's usage",
		icon: "BankOutlined",
	},
	{ value: "team", label: "Team Usage", description: "View usage by team", icon: "TeamOutlined" },
	...(admin.value
		? [
				{
					value: "customer",
					label: "Customer Usage",
					description: "View usage by customer accounts",
					icon: "ShoppingCartOutlined",
				},
				{ value: "tag", label: "Tag Usage", description: "View usage grouped by tags", icon: "TagsOutlined" },
				{ value: "agent", label: "Agent Usage (A2A)", description: "View usage by AI agents", icon: "RobotOutlined" },
				{ value: "user", label: "User Usage", description: "View usage by individual users", icon: "UserOutlined" },
				{
					value: "user-agent-activity",
					label: "User Agent Activity",
					description: "View detailed user agent activity logs",
					icon: "LineChartOutlined",
				},
			]
		: []),
]);
const entityOptions = computed<Record<string, EntityOption[]>>(() => ({
	organization: app.state.organizations.map((o) => ({ label: o.organization_alias ?? "", value: o.organization_id })),
	team: app.state.teams.map((t) => ({ label: t.team_alias ?? "", value: t.team_id })),
	customer: lists.customers,
	tag: lists.tags,
	agent: lists.agents,
	user: lists.users,
}));
const modelMetrics = computed(() => processActivityData(state.data, "models", app.state.teams)),
	keyMetrics = computed(() => processActivityData(state.data, "api_keys", app.state.teams)),
	mcpMetrics = computed(() => processActivityData(state.data, "mcp_servers", app.state.teams));
const models = computed(() => modelRankings(state.data)),
	groups = computed(() => modelRankings(state.data, true)),
	providers = computed(() => providerRankings(state.data)),
	keys = computed(() => keyRankings(state.data));
const days = computed(() => [...state.data.results].sort((a, b) => a.date.localeCompare(b.date)));
const tabs = [
	{ key: "cost", label: "Cost" },
	{ key: "models", label: "Model Activity" },
	{ key: "keys", label: "Key Activity" },
	{ key: "mcp", label: "MCP Server Activity" },
	{ key: "endpoints", label: "Endpoint Activity" },
];
function changeView(value: unknown) {
	if (typeof value === "string" && viewOptions.value.some((v) => v.value === value)) view.value = value as UsageView;
}
function changeUser(value: unknown) {
	selectedUser.value = typeof value === "string" ? value : null;
}
function changeDate(value: DateRangeValue) {
	dateChanging.value = true;
	date.value = value;
}
function icon(value: unknown) {
	return viewOptions.value.find((v) => v.value === value)?.icon || "GlobalOutlined";
}
function daily(row: Record<string, unknown>): DailyData {
	return row as unknown as DailyData;
}
</script>
<template>
	<div class="usage-page">
		<div class="usage-page-content">
			<div class="usage-toolbar">
				<div class="usage-view-select">
					<div class="usage-view-label">
						<h3>Usage View</h3>
						<p>Select the usage data you want to view</p>
					</div>
					<UiSelect class="usage-view-control" :model-value="view" :options="viewOptions" @update:model-value="changeView"
						><template #value="{ option }"
							><div class="usage-view-value">
								<div>
									<span class="usage-view-value-icon"><UiIcon :name="icon(option.value)" :size="16" /></span>
								</div>
								<span class="usage-view-value-label">{{ option.label }}</span>
							</div></template
						><template #option="{ option }"
							><span class="usage-view-option"
								><UiIcon :name="icon(option.value)" :size="16" /><span
									><b>{{ option.label }}</b
									><small>{{ option.description }}</small></span
								></span
							></template
						></UiSelect
					>
				</div>
				<UiSelect
					v-if="view === 'global' && admin"
					class="usage-user-filter"
					:model-value="selectedUser"
					:options="lists.users"
					placeholder="Select user to filter..."
					searchable
					clearable
					:filterable="false"
					:loading="lists.usersLoading"
					:empty-text="lists.usersLoading ? '' : 'No users found'"
					@update:model-value="changeUser"
					@search="catalog.searchUsers"
					@popup-scroll="catalog.scrollUsers"
					><template #footer
						><div v-if="lists.usersFetchingMore" class="usage-user-loading"><UiSpinner :size="14" /></div></template
				></UiSelect>
				<div class="usage-toolbar-date"><AdvancedDatePicker :value="date" show-quick-select @value-change="changeDate" /></div>
			</div>
			<UsageProgress
				:fetching="state.isFetchingMore"
				:cancelled="state.cancelled"
				:progress="state.progress"
				@cancel="store.cancel"
			/>
			<div v-if="view === 'global'">
				<div class="usage-global-tabs-toolbar">
					<div class="usage-global-tabs-scroll">
						<UiTabs v-model="tab" :items="tabs" appearance="tremor" class="usage-solid-tabs" />
					</div>
					<div class="usage-global-tab-actions">
						<UiButton size="small" @click="aiOpen = true"
							><template #icon
								><svg viewBox="0 0 16 16" fill="currentColor">
									<path
										d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11 6.5 7.5 3 6l3.5-1.5L8 1zm4 7l.75 1.75L14.5 10.5l-1.75.75L12 13l-.75-1.75L9.5 10.5l1.75-.75L12 8zM4 9l.75 1.75L6.5 11.5l-1.75.75L4 14l-.75-1.75L1.5 11.5l1.75-.75L4 9z"
									/></svg></template
							>Ask AI</UiButton
						><UiButton size="small" @click="exportOpen = true"
							><template #icon
								><svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
									/></svg></template
							>Export Data</UiButton
						>
					</div>
				</div>
				<div class="usage-global-panels">
					<div v-show="tab === 'cost'" class="usage-global-cost">
						<UsageMetrics
							class="usage-global-wide"
							:metadata="state.data.metadata"
							:total-spend="state.data.metadata.total_spend || 0"
							:max-budget="lists.maxBudget"
							:date-range-label="dateRangeLabel(date.from, date.to)"
							:show-token-breakdown="tokenBreakdown"
							@toggle="tokenBreakdown = !tokenBreakdown"
						/>
						<UiCard class="usage-panel usage-global-left" appearance="tremor"
							><h2>Daily Spend</h2>
							<UsageChartLoader v-if="state.loading" :is-date-changing="dateChanging" /><UsageChart
								v-else
								:data="days"
								index="date"
								:categories="['metrics.spend']"
								:height="288"
								:y-axis-width="100"
								:format="(v) => money(v, 'compact')"
								class="usage-daily-spend-chart"
								><template #tooltip="{ row }"
									><b>{{ row.date }}</b>
									<p class="usage-cyan">Spend: {{ money(daily(row).metrics.spend, 2) }}</p>
									<p>Requests: {{ daily(row).metrics.api_requests }}</p>
									<p>Successful: {{ daily(row).metrics.successful_requests }}</p>
									<p>Failed: {{ daily(row).metrics.failed_requests }}</p>
									<p>Tokens: {{ formatNumberWithCommas(daily(row).metrics.total_tokens, 0, false) }}</p></template
								></UsageChart
							></UiCard
						>
						<UsageTopModels
							v-model="modelMode"
							class="usage-global-right"
							:groups="groups"
							:individual="models"
							:loading="state.loading"
							:is-date-changing="dateChanging"
						/>
						<UsageProviderSpend
							class="usage-global-left"
							:provider-spend="providers"
							:loading="state.loading"
							:is-date-changing="dateChanging"
						/>
						<UiCard class="usage-panel usage-global-right" appearance="tremor"
							><h2>Top Virtual Keys</h2>
							<UsageTopKeys :rows="keys"
						/></UiCard>
					</div>
					<UsageActivity v-show="tab === 'models'" :model-metrics="modelMetrics" /><UsageActivity
						v-show="tab === 'keys'"
						:model-metrics="keyMetrics"
					/><UsageActivity v-show="tab === 'mcp'" :model-metrics="mcpMetrics" /><UsageEndpoint
						v-show="tab === 'endpoints'"
						:data="state.data"
					/>
				</div>
			</div>
			<template v-else-if="view === 'user-agent-activity'"><UsageUserAgent :date-range="date" /></template>
			<template v-else
				><UiAlert
					v-if="view === 'tag' && banner"
					type="info"
					title="Reusable credentials are automatically tracked as tags"
					closable
					class="usage-credential-banner"
					@close="banner = false"
					>When a reusable credential is used, it will appear as a tag prefixed with <code>Credential: </code>in this
					view.</UiAlert
				><UsageEntity :key="view" :entity-type="view" :options="entityOptions[view] ?? []" :date-range="date"
			/></template>
			<UsageUpstreamQuota :enabled="admin" />
		</div>
		<UsageExport
			v-model:open="exportOpen"
			entity-type="team"
			:data="state.data"
			:date-range="date"
			custom-title="Export Usage Data"
		/><UsageAiPanel v-model:open="aiOpen" />
	</div>
</template>
