<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import ModelList from "./ModelListComponent.vue";
import ModelAdd from "./ModelAddComponent.vue";
import ModelCredentials from "./ModelCredentialsComponent.vue";
import PassThroughEndpoints from "./PassThroughEndpointsComponent.vue";
import ModelHealth from "./ModelHealthComponent.vue";
import ModelRetrySettings from "./ModelRetrySettingsComponent.vue";
import ModelAliases from "./ModelAliasesComponent.vue";
import ModelPriceData from "./ModelPriceDataComponent.vue";
import ModelActionsDialog from "./ModelActionsDialogComponent.vue";
import ModelDetailsDrawer from "./ModelDetailsDrawerComponent.vue";
import { emptyModelCatalog, type DisplayProxyModel } from "../support/ModelModels";
import { loadModelCatalog } from "../data/ModelCatalogData";
import { modelsApi } from "../api/ModelsApi";
import { createModelsStore } from "../stores/ModelsStore";
import { createModelHealthStore } from "../stores/ModelHealthStore";
import { transformModels } from "../logic/ModelDataLogic";
import "./ModelsStyles.css";
import "./ModelFormsStyles.css";
import "./ModelDetailsStyles.css";
import "./ModelPassThroughStyles.css";
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
	actionModel = ref<DisplayProxyModel | null>(null);
let disposed = false;
const role = computed(() => auth.userRole.value),
	userId = computed(() => auth.state.session?.user_id ?? ""),
	premium = computed(() => Boolean(auth.state.session?.premium_user));
const admin = computed(() => ["Admin", "Admin Viewer", "proxy_admin", "proxy_admin_viewer", "org_admin"].includes(role.value));
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
const tabs = computed(() => [
	{ key: "models", label: admin.value ? "All Models" : "Your Models" },
	...(addAllowed.value ? [{ key: "add-model", label: "Add Model" }] : []),
	...(admin.value
		? [
				{ key: "credentials", label: "LLM Credentials" },
				{ key: "pass-through", label: "Pass-Through Endpoints" },
				{ key: "health", label: "Health Status" },
				{ key: "retries", label: "Model Retry Settings" },
				{ key: "aliases", label: "Model Group Alias" },
				{ key: "price-data", label: "Price Data Reload" },
			]
		: []),
]);
const tab = computed(() => (tabs.value.some((item) => item.key === route.query.tab) ? String(route.query.tab) : "models"));
const modelGroups = computed(() => [...new Set(store.state.rows.map((model) => model.model_name))].sort());
const processed = computed(() => transformModels(store.state.rows, catalog.costs));
function changeTab(value: string) {
	void router.replace({ query: { ...route.query, tab: value } });
}
function actions(mode: typeof action.value, model: DisplayProxyModel | null = null) {
	actionModel.value = model;
	action.value = mode;
}
async function refresh() {
	lastRefreshed.value = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	await store.load();
}
async function credentials() {
	catalog.credentials = await modelsApi.fetchCredentials();
}
function credential() {
	changeTab("credentials");
}
watch(
	() => store.state.rows.map((model) => model.model_info.id ?? "").join("|"),
	() => {
		health.initialize(store.state.rows.map((model) => model.model_info.id ?? ""));
		void health.hydrate();
	},
);
watch(
	() => [ready.value, route.query.tab, tabs.value.map((item) => item.key).join("|")] as const,
	() => {
		if (ready.value && route.query.tab && route.query.tab !== tab.value) changeTab(tab.value);
	},
);
onMounted(async () => {
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
	<div v-if="role === 'Admin Viewer'" class="model-access-denied">
		<h1>Access Denied</h1>
		<p>Ask your proxy admin for access to view all models</p>
	</div>
	<div v-else class="models-page">
		<div class="models-layout">
			<header class="models-heading">
				<div>
					<h2>Model Management</h2>
					<p>{{ admin ? "Add and manage models for the proxy" : "Add models for teams you are an admin for." }}</p>
				</div>
				<a href="https://models.litellm.ai/?request=true" target="_blank" rel="noreferrer" class="models-request-provider"
					><UiIcon name="PlusCircleOutlined" :size="12" />Request Provider</a
				>
			</header>
			<UiTabs :model-value="tab" :items="tabs" appearance="tremor" grouped class="models-main-tabs" @update:model-value="changeTab"
				><template #extra
					><span v-if="lastRefreshed" class="models-last-refreshed">Last Refreshed: {{ lastRefreshed }}</span
					><button class="models-refresh" aria-label="Refresh models" @click="refresh">
						<UiHeroIcon name="RefreshIcon" :size="12" /></button
				></template>
				<ModelList
					v-if="tab === 'models'"
					:store="store"
					:catalog="catalog"
					:health="health"
					:admin="role === 'Admin'"
					:user-id="userId"
					@select="selected = $event"
					@fallback="actions('fallback', $event)"
					@override="actions('override', $event)"
					@delete="actions('delete', $event)"
					@settings="actions('settings')"
					@credential="credential"
				/>
				<ModelAdd
					v-if="tab === 'add-model' && ready"
					:catalog="catalog"
					:admin="admin"
					:team-admin="teamAdmin"
					:premium="premium"
					:user-id="userId"
					@created="refresh"
				/>
				<ModelCredentials v-if="tab === 'credentials' && ready" :catalog="catalog" @changed="credentials" />
				<PassThroughEndpoints
					v-if="tab === 'pass-through' && ready"
					:catalog="catalog"
					:admin="role === 'Admin' || role === 'admin'"
					:premium="premium"
				/>
				<ModelHealth
					v-if="tab === 'health' && ready"
					:models="processed"
					:catalog="catalog"
					:health="health"
					@select="selected = $event"
				/>
				<ModelRetrySettings v-if="tab === 'retries' && ready" :catalog="catalog" :model-groups="modelGroups" />
				<ModelAliases v-if="tab === 'aliases' && ready" :catalog="catalog" />
				<ModelPriceData v-if="tab === 'price-data'" @reloaded="refresh" /> </UiTabs
			><ModelActionsDialog
				v-if="action"
				:mode="action"
				:model="actionModel"
				:catalog="catalog"
				:model-groups="modelGroups"
				@close="action = null"
				@changed="refresh"
			/><ModelDetailsDrawer
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
