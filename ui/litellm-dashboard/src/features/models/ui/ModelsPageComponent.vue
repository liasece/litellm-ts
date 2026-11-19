<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import UiAccessDenied from "../../platform/ui/UiAccessDenied.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { currentPageKey } from "../../application/logic/PageContext";
import { dashboardHref } from "../../application/logic/NavigationLogic";
import ModelList from "./ModelListComponent.vue";
import ModelAdd from "./ModelAddComponent.vue";
import ModelCredentials from "./ModelCredentialsComponent.vue";
import ModelRetrySettings from "./ModelRetrySettingsComponent.vue";
import ModelAliases from "./ModelAliasesComponent.vue";
import ModelPriceData from "./ModelPriceDataComponent.vue";
import ModelActionsDialog from "./ModelActionsDialogComponent.vue";
import ModelAliasConvertDialog from "./ModelAliasConvertDialogComponent.vue";
import ModelDetailsDrawer from "./ModelDetailsDrawerComponent.vue";
import { emptyModelCatalog, type DisplayProxyModel } from "../support/ModelModels";
import { loadModelCatalog } from "../data/ModelCatalogData";
import { modelsApi } from "../api/ModelsApi";
import { createModelsStore } from "../stores/ModelsStore";
import { createModelHealthStore } from "../stores/ModelHealthStore";
import { modelManagementSection, modelSectionFromLegacyTab, pageByModelSection } from "../logic/ModelManagementSections";
import { getServerRootPath } from "../../platform/api/HttpApiClient";
import { subscriptionAccountsHref } from "../../subscriptions/logic/SubscriptionProviderLogic";
import "./ModelsStyles.css";
import "./ModelFormsStyles.css";
import "./ModelDetailsStyles.css";
import "./ModelOperationsStyles.css";
const auth = useAuthenticationStore(),
	route = useRoute(),
	router = useRouter(),
	catalog = reactive(emptyModelCatalog()),
	store = createModelsStore(),
	health = createModelHealthStore();
const ready = ref(false),
	lastRefreshed = ref(""),
	selected = ref<string | null>(null),
	action = ref<"fallback" | "override" | "settings" | "delete" | null>(null),
	actionModel = ref<DisplayProxyModel | null>(null),
	convertModel = ref<DisplayProxyModel | null>(null),
	addOpen = ref(false);
let disposed = false;
const role = computed(() => auth.userRole.value),
	userId = computed(() => auth.state.session?.user_id ?? ""),
	premium = computed(() => Boolean(auth.state.session?.premium_user));
const admin = computed(() => ["Admin", "Admin Viewer", "proxy_admin", "proxy_admin_viewer", "org_admin"].includes(role.value));
const uiBase = computed(() => {
	const root = getServerRootPath().replace(/\/+$/, "");
	return (root === "/" ? "" : root) + "/ui";
});
const subscriptionsHref = computed(() => subscriptionAccountsHref(uiBase.value));
const teamAdmin = computed(() =>
	catalog.teams.some((team) => team.members_with_roles?.some((member) => member.user_id === userId.value && member.role === "admin")),
);
const addAllowed = computed(
	() =>
		["Admin", "proxy_admin"].includes(role.value) ||
		(teamAdmin.value &&
			!(
				["Internal User", "Internal Viewer"].includes(role.value) &&
				catalog.uiSettings.disable_model_add_for_internal_users === true
			)),
);
/** 同一个组件承载多个页面，分区来自 URL 解析出的页面 id；切页面不会重建组件，数据与筛选都还在。 */
const page = inject(currentPageKey, null);
const section = computed(() => modelManagementSection(page?.value ?? "models"));
const titles: Readonly<Record<ReturnType<typeof modelManagementSection>, string>> = {
	models: "",
	credentials: "LLM Credentials",
	retries: "Model Retry Settings",
	aliases: "Model Group Alias",
	prices: "Price Data Reload",
};
const title = computed(() => (section.value === "models" ? (admin.value ? "All Models" : "Your Models") : titles[section.value]));
const subtitle = computed(() =>
	section.value === "models" ? (admin.value ? "Add and manage models for the proxy" : "Add models for teams you are an admin for.") : "",
);
/** 管理页只对管理员开放；Admin Viewer 与 All Models 一致地显示无权访问，而不是给出空白页面。 */
const denied = computed(() => role.value === "Admin Viewer" || (section.value !== "models" && !admin.value));
const modelGroups = computed(() => [...new Set(store.state.rows.map((model) => model.model_name))].sort());
function actions(mode: typeof action.value, model: DisplayProxyModel | null = null) {
	actionModel.value = model;
	action.value = mode;
}
async function refresh() {
	lastRefreshed.value = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	await store.load();
}
/**
 * 转换已经把模型换成别名，列表要重取部署；别名表也同步成刚保存的整张表，
 * 免得「Model Group Alias」页面还显示转换前的旧内容。
 */
function converted(aliases: Record<string, unknown>) {
	catalog.router = { ...catalog.router, model_group_alias: aliases };
	void refresh();
}
async function credentials() {
	catalog.credentials = await modelsApi.fetchCredentials();
}
/** 列表里的凭据链接跳到凭据页面；非管理员原本也切不过去，这里直接忽略。 */
function credential() {
	if (admin.value) void router.push(dashboardHref("models-credentials", uiBase.value));
}
function created() {
	addOpen.value = false;
	void refresh();
}
watch(
	() => store.state.rows.map((model) => model.model_info.id ?? "").join("|"),
	() => {
		health.initialize(store.state.rows.map((model) => model.model_info.id ?? ""));
		void health.hydrate();
	},
);
/**
 * 冷却只在 All Models 可见时轮询：页面组件切分区不会重建，但其他分区不需要模型运行态；
 * 首次列表加载完成后再启动，避免空列表先发一次重复请求。
 */
watch(
	[ready, section, denied],
	([loaded, current, accessDenied]) => {
		if (loaded && !accessDenied && current === "models") store.startAutoRefresh();
		else store.stopAutoRefresh();
	},
	{ immediate: true },
);
onMounted(async () => {
	// 旧的 `?page=models&tab=health` 书签改写到分区路径，地址栏与侧边栏选中项保持一致。
	const legacyTab = typeof route.query.tab === "string" ? route.query.tab : null;
	const legacySection = legacyTab === null ? undefined : modelSectionFromLegacyTab(legacyTab);
	if (legacySection) {
		if (legacyTab === "add-model") addOpen.value = true;
		await router.replace(dashboardHref(pageByModelSection[legacySection], uiBase.value));
	}
	const result = await Promise.allSettled([loadModelCatalog(), store.load()]);
	if (disposed) return;
	if (result[0].status === "fulfilled") Object.assign(catalog, result[0].value);
	ready.value = true;
});
onBeforeUnmount(() => {
	disposed = true;
	store.dispose();
	health.dispose();
});
</script>
<template>
	<UiAccessDenied v-if="denied" message="Ask your proxy admin for access to view all models" />
	<div v-else class="models-page">
		<div class="models-layout">
			<header class="models-heading">
				<div>
					<h2>{{ title }}</h2>
					<p v-if="subtitle">{{ subtitle }}</p>
				</div>
				<div class="model-inline model-heading-actions">
					<template v-if="section === 'models'">
						<span v-if="lastRefreshed" class="models-last-refreshed">Last Refreshed: {{ lastRefreshed }}</span>
						<button class="models-refresh" aria-label="Refresh models" @click="refresh">
							<UiHeroIcon name="RefreshIcon" :size="12" /></button
						><UiButton v-if="addAllowed" appearance="tremor" size="small" variant="primary" @click="addOpen = true"
							><template #icon><UiIcon name="PlusOutlined" /></template>Add Model</UiButton
						>
					</template>
					<a v-if="admin" :href="subscriptionsHref" class="models-request-provider"
						><UiIcon name="CrownOutlined" :size="12" />Subscription accounts</a
					>
					<a href="https://models.litellm.ai/?request=true" target="_blank" rel="noreferrer" class="models-request-provider"
						><UiIcon name="PlusCircleOutlined" :size="12" />Request Provider</a
					>
				</div>
			</header>
			<div class="models-section">
				<ModelList
					v-if="section === 'models'"
					:store="store"
					:catalog="catalog"
					:health="health"
					:admin="role === 'Admin'"
					:user-id="userId"
					:subscriptions-base="uiBase"
					@select="selected = $event"
					@fallback="actions('fallback', $event)"
					@override="actions('override', $event)"
					@convert="convertModel = $event"
					@delete="actions('delete', $event)"
					@settings="actions('settings')"
					@credential="credential"
					@refresh="refresh"
				/>
				<ModelCredentials v-else-if="section === 'credentials' && ready" :catalog="catalog" @changed="credentials" />
				<ModelRetrySettings v-else-if="section === 'retries' && ready" :catalog="catalog" :model-groups="modelGroups" />
				<ModelAliases v-else-if="section === 'aliases' && ready" :catalog="catalog" />
				<ModelPriceData v-else-if="section === 'prices'" @reloaded="refresh" />
			</div>
			<UiDialog :open="addOpen" title="Add Model" width="900" scroll-mode="overlay" @update:open="addOpen = $event">
				<ModelAdd
					v-if="addOpen && ready"
					:catalog="catalog"
					:admin="admin"
					:team-admin="teamAdmin"
					:premium="premium"
					:user-id="userId"
					@created="created"
				/>
			</UiDialog>
			<ModelActionsDialog
				v-if="action"
				:mode="action"
				:model="actionModel"
				:catalog="catalog"
				:model-groups="modelGroups"
				@close="action = null"
				@changed="refresh"
			/>
			<ModelAliasConvertDialog
				v-if="convertModel"
				:open="true"
				:model="convertModel"
				@close="convertModel = null"
				@converted="converted"
			/>
			<ModelDetailsDrawer
				v-if="selected"
				:model-id="selected"
				:catalog="catalog"
				:role="role"
				:user-id="userId"
				@close="selected = null"
				@updated="refresh"
			/>
		</div>
	</div>
</template>
