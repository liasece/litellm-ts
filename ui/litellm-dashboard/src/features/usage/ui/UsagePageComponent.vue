<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { currentPageKey } from "../../application/logic/PageContext";
import { usageSection } from "../logic/UsageSections";
import { isAdminRole, isUsageAdminRole } from "../../identity/logic/UserRoleLogic";
import { useApplicationStore } from "../../application/stores/ApplicationStore";
import AdvancedDatePicker from "../../date-range/ui/AdvancedDatePickerComponent.vue";
import type { DateRangeValue } from "../../date-range/support/DateRangeModels";
import type { DailyActivityResponse, EntityOption, UsageDetailView, UsageQuery, UsageView } from "../support/UsageModels";
import { createUsageOverviewStore } from "../stores/UsageOverviewStore";
import { createUsageCatalogStore } from "../stores/UsageCatalogStore";
import { dateRangeLabel } from "../logic/UsageSummaryLogic";
import { activitySeries } from "../logic/UsageSeriesLogic";
import { usageDayRange } from "../logic/UsageEmptyDaysLogic";
import {
	detailActivity,
	emptyUsageMetadata,
	summaryKeyRankings,
	summaryModelRankings,
	summaryProviderRankings,
} from "../logic/UsageOverviewLogic";
import UsageSeriesCard from "./UsageSeriesCardComponent.vue";
import UsageMetrics from "./UsageMetricsCardsComponent.vue";
import UsageTopModels from "./UsageTopModelsComponent.vue";
import UsageProviderSpend from "./UsageProviderSpendComponent.vue";
import UsageTopKeys from "./UsageTopKeysComponent.vue";
import UsageActivity from "./UsageActivityComponent.vue";
import UsageEndpoint from "./UsageEndpointComponent.vue";
import UsageEntity from "./UsageEntityComponent.vue";
import UsageExport from "./UsageExportDialogComponent.vue";
import UsageUpstreamQuota from "./UsageUpstreamQuotaComponent.vue";
import UiAccessDenied from "../../platform/ui/UiAccessDenied.vue";
import "./UsageStyles.css";
import "../styles/UsageAuxiliaryStyles.css";
const auth = useAuthenticationStore(),
	app = useApplicationStore();
const admin = computed(() => isAdminRole(auth.userRole.value));
// 账号视图与后端 isUsageAdmin 同口径；session.user_role 才是原始角色，
// userRole 已经格式化成 "Admin"/"Admin Viewer"，会丢掉 proxy_admin 的区分。
const accountAdmin = computed(() => isUsageAdminRole(auth.state.session?.user_role ?? ""));
const date = ref<DateRangeValue>({ from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), to: new Date() });
const view = ref<UsageView>("global"),
	selectedUser = ref<string | null>(admin.value ? null : (auth.state.session?.user_id ?? null));
const modelMode = ref<"groups" | "individual">("groups"),
	exportOpen = ref(false),
	exportData = ref<DailyActivityResponse | null>(null),
	exportLoading = ref(false),
	dateChanging = ref(false);
const overview = createUsageOverviewStore(),
	catalog = createUsageCatalogStore(),
	lists = catalog.state;
/** 同一个组件承载多个页面：分区来自 URL 解析出的页面 id，切页面时组件实例不重建，日期与视图选择都留着。 */
const page = inject(currentPageKey, null);
const section = computed(() => usageSection(page?.value ?? "new_usage"));
const sectionTitles = {
	cost: "Cost",
	models: "Model Activity",
	keys: "Key Activity",
	endpoints: "Endpoint Activity",
	accounts: "Upstream Account Activity",
	quota: "Upstream Account Quota",
} as const;
const effectiveUser = computed(() => (admin.value ? selectedUser.value : (auth.state.session?.user_id ?? null)));
function currentQuery(): UsageQuery | null {
	const from = date.value.from,
		to = date.value.to;
	if (!from || !to || !auth.state.session) return null;
	return { entity: "global", from, to, selected: effectiveUser.value ? [effectiveUser.value] : [] };
}
const detailView = computed<UsageDetailView | null>(() => {
	if (view.value !== "global") return null;
	if (section.value === "models") return "models";
	if (section.value === "keys") return "api_keys";
	if (section.value === "endpoints") return "endpoints";
	if (section.value === "accounts") return "upstream_accounts";
	// Cost 页的每日堆叠图与 Model Activity 是同一份数据，先到的人拉一次、后来的人复用缓存。
	if (section.value === "cost") return "models";
	return null;
});
async function loadActiveDetail() {
	if (section.value === "accounts" && !accountAdmin.value) return;
	const query = currentQuery(),
		active = detailView.value;
	if (!query || !active || !overview.state.summary || overview.state.detailLoading[active] || overview.state.details[active]) return;
	// 图与折叠列表共用同一份明细；detail 按花费排序，只取第一页会让免费但用量大的模型
	// 从趋势图里整段消失，所以这里一次把该维度的分页取齐。
	await overview.loadCompleteDetail(query, active);
}
watch(
	() => [date.value.from?.getTime(), date.value.to?.getTime(), effectiveUser.value, auth.state.session, view.value],
	async () => {
		exportData.value = null;
		const query = currentQuery();
		if (!query || view.value !== "global") {
			overview.reset();
			dateChanging.value = false;
			return;
		}
		await overview.loadSummary(query);
		if (!overview.state.loading) dateChanging.value = false;
		// 日期变化时当前分区的 detail 已被 summary 重置，只有仍停在明细分区才需要补拉第一页。
		await loadActiveDetail();
	},
	{ immediate: true },
);
watch([section, view], async () => {
	if (view.value !== "global") return;
	await loadActiveDetail();
});
watch(
	() => [admin.value, auth.state.session?.user_id],
	() => {
		if (!admin.value && auth.state.session?.user_id) selectedUser.value = auth.state.session.user_id;
	},
	{ immediate: true },
);
void catalog.initialize(admin.value);
onBeforeUnmount(() => {
	overview.reset();
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
			]
		: []),
]);
const entityOptions = computed<Record<string, EntityOption[]>>(() => ({
	organization: app.state.organizations.map((o) => ({ label: o.organization_alias ?? "", value: o.organization_id })),
	team: app.state.teams.map((t) => ({ label: t.team_alias ?? "", value: t.team_id })),
	customer: [],
	tag: [],
	agent: [],
	user: lists.users,
}));
const modelMetrics = computed(() => detailActivity(overview.state.details.models ?? null, app.state.teams, false));
const keyMetrics = computed(() => detailActivity(overview.state.details.api_keys ?? null, app.state.teams, true));
const modelSeries = computed(() => activitySeries(overview.state.details.models ?? null, app.state.teams, false));
const keySeries = computed(() => activitySeries(overview.state.details.api_keys ?? null, app.state.teams, true));
const endpointSeries = computed(() => activitySeries(overview.state.details.endpoints ?? null, app.state.teams, false));
const accountMetrics = computed(() => detailActivity(overview.state.details.upstream_accounts ?? null, app.state.teams, false, true));
const accountSeries = computed(() => activitySeries(overview.state.details.upstream_accounts ?? null, app.state.teams, false, true));
const models = computed(() => summaryModelRankings(overview.state.summary)),
	groups = computed(() => summaryModelRankings(overview.state.summary, true)),
	providers = computed(() => summaryProviderRankings(overview.state.summary)),
	keys = computed(() => summaryKeyRankings(overview.state.summary));
const metadata = computed(() => overview.state.summary?.metadata ?? emptyUsageMetadata());
/** 所选范围里的每一天；缺数据的日子也要在图上占位，所以先补齐再交给图表。 */
const dayRange = computed(() => (date.value.from && date.value.to ? usageDayRange(date.value.from, date.value.to) : ([] as string[])));
/** 汇总或分模型明细还没回来时，Cost 页的两张堆叠图先显示骨架而不是“没有用量”。 */
const costSeriesLoading = computed(() => overview.state.loading || Boolean(overview.state.detailLoading.models));
function detailHasMore(active: UsageDetailView): boolean {
	return Boolean(overview.state.details[active]?.metadata.has_more);
}
function detailLoadingMore(active: UsageDetailView): boolean {
	return Boolean(overview.state.detailLoading[active]);
}
async function loadMore(active: UsageDetailView) {
	const query = currentQuery(),
		detail = overview.state.details[active];
	if (!query || !detail?.metadata.has_more) return;
	await overview.loadDetail(query, active, detail.metadata.page + 1, true);
}
async function openExport() {
	const query = currentQuery();
	if (!query) return;
	exportLoading.value = true;
	try {
		const data = await overview.loadFull(query);
		if (data) {
			exportData.value = data;
			exportOpen.value = true;
		}
	} finally {
		exportLoading.value = false;
	}
}
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
</script>
<template>
	<div class="usage-page">
		<div class="usage-page-content">
			<header v-if="section !== 'quota'" class="usage-heading">
				<div>
					<h2>{{ view === "global" ? sectionTitles[section] : viewOptions.find((option) => option.value === view)?.label }}</h2>
				</div>
				<UiButton
					v-if="view === 'global' && section !== 'accounts'"
					size="small"
					:loading="exportLoading"
					:disabled="exportLoading"
					@click="openExport"
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
			</header>
			<template v-if="section === 'quota'">
				<UiAccessDenied v-if="!admin" message="Ask your proxy admin for access to upstream account quota" />
				<UsageUpstreamQuota v-else :enabled="true" />
			</template>
			<template v-else>
				<UiAccessDenied
					v-if="section === 'accounts' && !accountAdmin"
					message="Ask your proxy admin for access to upstream account activity"
				/>
				<template v-if="section !== 'accounts' || accountAdmin">
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
						<div class="usage-toolbar-date">
							<AdvancedDatePicker :value="date" show-quick-select @value-change="changeDate" />
						</div>
					</div>
					<div v-if="view === 'global'">
						<div class="usage-global-panels">
							<div v-show="section === 'cost'" class="usage-global-cost">
								<UsageMetrics
									class="usage-global-wide"
									:metadata="metadata"
									:total-spend="metadata.total_spend || 0"
									:max-budget="lists.maxBudget"
									:date-range-label="dateRangeLabel(date.from, date.to)"
								/>
								<UiCard class="usage-panel usage-global-half" appearance="tremor">
									<UsageSeriesCard
										chart="spend"
										:series="modelSeries"
										entity-kind="model"
										:dates="dayRange"
										:loading="costSeriesLoading"
										:is-date-changing="dateChanging"
									/>
								</UiCard>
								<UiCard class="usage-panel usage-global-half" appearance="tremor">
									<UsageSeriesCard
										chart="tokens"
										:series="modelSeries"
										entity-kind="model"
										:dates="dayRange"
										:loading="costSeriesLoading"
										:is-date-changing="dateChanging"
									/>
								</UiCard>
								<UsageTopModels
									v-model="modelMode"
									class="usage-global-half"
									dimension="spend"
									:groups="groups"
									:individual="models"
									:loading="overview.state.loading"
									:is-date-changing="dateChanging"
								/>
								<UsageTopModels
									v-model="modelMode"
									class="usage-global-half"
									dimension="tokens"
									:show-mode-toggle="false"
									:groups="groups"
									:individual="models"
									:loading="overview.state.loading"
									:is-date-changing="dateChanging"
								/>
								<UsageProviderSpend
									class="usage-global-left"
									:provider-spend="providers"
									:loading="overview.state.loading"
									:is-date-changing="dateChanging"
								/>
								<UiCard class="usage-panel usage-global-right" appearance="tremor"
									><h2>Top Virtual Keys</h2>
									<UsageTopKeys :rows="keys"
								/></UiCard>
							</div>
							<UsageActivity
								v-if="section === 'models'"
								:model-metrics="modelMetrics"
								entity-kind="model"
								:loading="overview.state.detailLoading.models"
								:has-more="detailHasMore('models')"
								:loading-more="detailLoadingMore('models')"
								:series="modelSeries"
								:dates="dayRange"
								@load-more="loadMore('models')"
							/>
							<UsageActivity
								v-if="section === 'keys'"
								:model-metrics="keyMetrics"
								entity-kind="key"
								:loading="overview.state.detailLoading.api_keys"
								:has-more="detailHasMore('api_keys')"
								:loading-more="detailLoadingMore('api_keys')"
								:series="keySeries"
								:dates="dayRange"
								@load-more="loadMore('api_keys')"
							/>
							<UsageEndpoint
								v-if="section === 'endpoints'"
								:detail="overview.state.details.endpoints ?? null"
								:series="endpointSeries"
								:dates="dayRange"
								:loading="overview.state.detailLoading.endpoints"
							/>
							<UsageActivity
								v-if="section === 'accounts'"
								:model-metrics="accountMetrics"
								entity-kind="account"
								:loading="overview.state.detailLoading.upstream_accounts"
								:has-more="detailHasMore('upstream_accounts')"
								:loading-more="detailLoadingMore('upstream_accounts')"
								:series="accountSeries"
								:dates="dayRange"
								@load-more="loadMore('upstream_accounts')"
							/>
						</div>
					</div>
					<template v-else
						><UsageEntity :key="view" :entity-type="view" :options="entityOptions[view] ?? []" :date-range="date"
					/></template>
				</template>
			</template>
		</div>
		<UsageExport
			v-if="exportData"
			v-model:open="exportOpen"
			entity-type="team"
			:data="exportData"
			:date-range="date"
			custom-title="Export Usage Data"
		/>
	</div>
</template>
