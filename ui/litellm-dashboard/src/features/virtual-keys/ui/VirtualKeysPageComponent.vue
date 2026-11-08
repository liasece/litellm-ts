<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import FilterBar from "../../filters/ui/FilterBarComponent.vue";
import type { FilterOption } from "../../filters/support/FilterModels";
import PaginatedChoice from "../../selectors/ui/PaginatedChoiceComponent.vue";
import { canCreateVirtualKey, canModifyVirtualKey } from "../logic/KeyPermissionLogic";
import { createVirtualKeysStore, emptyKeyFilters } from "../stores/VirtualKeysStore";
import { rememberCreatedKey } from "../stores/CreatedKeysHistoryStore";
import type { VirtualKey } from "../support/VirtualKeyModels";
import KeyCreateDialog from "./KeyCreateDialogComponent.vue";
import KeyDetailDrawer from "./KeyDetailDrawerComponent.vue";
import VirtualKeysTable from "./VirtualKeysTableComponent.vue";
import "./styles/VirtualKeysStyles.css";
const aliasSlot = "field-Key Alias";
const auth = useAuthenticationStore();
const route = useRoute();
const store = createVirtualKeysStore();
const { state } = store;
const createOpen = ref(false);
const detailOpen = ref(false);
const selected = ref<VirtualKey | null>(null);
const filterValues = ref<Record<string, string>>({ "Team ID": "", "Organization ID": "", "Key Alias": "", "User ID": "", "Key Hash": "" });
const prefill = computed(
	() => new URLSearchParams(Object.entries(route.query).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : []))),
);
const filterOptions = computed<FilterOption[]>(() => [
	{
		name: "Team ID",
		isSearchable: true,
		searchFn: async (query) =>
			state.catalog.teams
				.filter((team) => [team.team_id, team.team_alias].some((value) => value?.toLowerCase().includes(query.toLowerCase())))
				.map((team) => ({ value: team.team_id, label: (team.team_alias || team.team_id) + " (" + team.team_id + ")" })),
	},
	{
		name: "Organization ID",
		isSearchable: true,
		searchFn: async (query) =>
			state.catalog.organizations
				.filter((org) => org.organization_id.toLowerCase().includes(query.toLowerCase()))
				.map((org) => ({ value: org.organization_id, label: org.organization_id + " (" + org.organization_id + ")" })),
	},
	{ name: "Key Alias" },
	{ name: "User ID" },
	{ name: "Key Hash" },
]);
const pageCount = computed(() => Math.ceil(state.total / state.pageSize));
const range = computed(() => (state.page - 1) * state.pageSize + 1 + " - " + Math.min(state.page * state.pageSize, state.total));
let timer: ReturnType<typeof setTimeout> | null = null;
function filters(values: Record<string, string>) {
	filterValues.value = { ...values };
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => {
		timer = null;
		void store.filter({
			team: values["Team ID"] || "",
			organization: values["Organization ID"] || "",
			alias: values["Key Alias"] || "",
			user: values["User ID"] || "",
			hash: values["Key Hash"] || "",
		});
	}, 300);
}
function reset() {
	if (timer) clearTimeout(timer);
	filterValues.value = { "Team ID": "", "Organization ID": "", "Key Alias": "", "User ID": "", "Key Hash": "" };
	void store.filter(emptyKeyFilters());
}
function select(key: VirtualKey) {
	selected.value = key;
	detailOpen.value = true;
}
function canModify(key: VirtualKey) {
	return canModifyVirtualKey(key, auth.userRole.value, auth.state.session?.user_id || "", state.catalog.teams);
}
function updated(response: Record<string, unknown>) {
	if (selected.value) selected.value = { ...selected.value, ...response };
	void store.refresh();
}
function created(response: Record<string, unknown>) {
	rememberCreatedKey(auth.state.session?.user_id || "", response);
	try {
		window.localStorage.removeItem("userData" + auth.state.session?.user_id);
	} catch {
		/* Storage can be unavailable. */
	}
	void store.refresh();
}
function storage() {
	void store.refresh();
}
onMounted(async () => {
	window.addEventListener("storage", storage);
	void store.refresh();
	await store.catalog();
	if (route.query.create === "true" || route.query.create_key === "true") createOpen.value = true;
});
onBeforeUnmount(() => {
	window.removeEventListener("storage", storage);
	if (timer) clearTimeout(timer);
	store.dispose();
});
</script>
<template>
	<div v-if="auth.userRole.value === 'Admin Viewer'" class="vk-access-denied">
		<h1>Access Denied</h1>
		<p>Ask your proxy admin for access to create keys</p>
	</div>
	<div v-else class="vk-page">
		<div class="vk-grid">
			<div class="vk-column">
				<div>
					<UiButton
						v-if="canCreateVirtualKey(auth.userRole.value)"
						appearance="tremor"
						variant="primary"
						@click="createOpen = true"
						>+ Create New Key</UiButton
					>
				</div>
				<div class="vk-list">
					<div class="vk-list-content">
						<UiAlert v-if="state.error" type="error" class="vk-list-error">{{ state.error }}</UiAlert>
						<div class="vk-filters">
							<FilterBar :options="filterOptions" :values="filterValues" @apply="filters" @reset="reset"
								><template #[aliasSlot]="{ value, update }"
									><PaginatedChoice
										:model-value="value"
										kind="key-alias"
										placeholder="Select a key alias"
										@update:model-value="update" /></template
							></FilterBar>
						</div>
						<div class="vk-toolbar">
							<div class="vk-toolbar-left">
								<span v-if="!state.loading">Showing {{ range }} of {{ state.total }} results</span
								><span v-else class="vk-skeleton vk-skeleton--range" /><UiButton
									:disabled="state.refreshing"
									title="Fetch data"
									@click="store.refresh"
									><template #icon><UiIcon name="SyncOutlined" class="vk-fetch-icon" /></template
									>{{ state.refreshing ? "Fetching" : "Fetch" }}</UiButton
								>
							</div>
							<div class="vk-toolbar-right">
								<span>Page {{ state.page }} of {{ pageCount }}</span
								><button
									type="button"
									class="vk-page-button"
									:disabled="state.page <= 1"
									@click="store.page(state.page - 1)"
								>
									Previous</button
								><button
									type="button"
									class="vk-page-button"
									:disabled="state.page >= pageCount"
									@click="store.page(state.page + 1)"
								>
									Next
								</button>
							</div>
						</div>
						<VirtualKeysTable
							:rows="state.rows"
							:catalog="state.catalog"
							:loading="state.loading"
							:sort-by="state.sortBy"
							:sort-order="state.sortOrder"
							:pending-token="state.pendingToken"
							:can-modify="canModify"
							@select="select"
							@sort="store.sort"
							@toggle-enabled="store.toggleEnabled"
						/>
					</div>
				</div>
			</div>
		</div>
		<KeyCreateDialog v-model:open="createOpen" :catalog="state.catalog" :rows="state.rows" :prefill="prefill" @created="created" />
		<KeyDetailDrawer
			v-model:open="detailOpen"
			:key-data="selected"
			:catalog="state.catalog"
			@updated="updated"
			@deleted="store.refresh"
		/>
	</div>
</template>
