<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { canCreateVirtualKey, canModifyVirtualKey } from "../logic/KeyPermissionLogic";
import type { UiTableActiveFilter, UiTableFilterChoice, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import type { KeyFilters } from "../support/VirtualKeyModels";
import { createVirtualKeysStore } from "../stores/VirtualKeysStore";
import { rememberCreatedKey } from "../stores/CreatedKeysHistoryStore";
import type { VirtualKey } from "../support/VirtualKeyModels";
import KeyCreateDialog from "./KeyCreateDialogComponent.vue";
import KeyDetailDrawer from "./KeyDetailDrawerComponent.vue";
import VirtualKeysTable from "./VirtualKeysTableComponent.vue";
import "./styles/VirtualKeysStyles.css";
const auth = useAuthenticationStore();
const route = useRoute();
const store = createVirtualKeysStore();
const { state } = store;
const createOpen = ref(false);
const detailOpen = ref(false);
const selected = ref<VirtualKey | null>(null);
const prefill = computed(
	() => new URLSearchParams(Object.entries(route.query).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : []))),
);
function teamChoices(term: string): UiTableFilterChoice[] {
	const query = term.trim().toLowerCase();
	return state.catalog.teams.flatMap((team) => {
		const alias = typeof team.team_alias === "string" ? team.team_alias : "";
		if (query && !team.team_id.toLowerCase().includes(query) && !alias.toLowerCase().includes(query)) return [];
		return [{ value: team.team_id, label: alias || team.team_id, description: alias ? team.team_id : undefined }];
	});
}
function organizationChoices(term: string): UiTableFilterChoice[] {
	const query = term.trim().toLowerCase();
	return state.catalog.organizations.flatMap((org) => {
		const alias = org.organization_alias || "";
		if (query && !org.organization_id.toLowerCase().includes(query) && !alias.toLowerCase().includes(query)) return [];
		return [{ value: org.organization_id, label: alias || org.organization_id, description: alias ? org.organization_id : undefined }];
	});
}
function teamLabel(id: string): string {
	const team = state.catalog.teams.find((item) => item.team_id === id);
	return team?.team_alias || id;
}
function organizationLabel(id: string): string {
	const org = state.catalog.organizations.find((item) => item.organization_id === id);
	return org?.organization_alias || id;
}
const filterFields = computed<Record<string, readonly UiTableFilterField[]>>(() => ({
	token: [{ key: "hash", label: "Key Hash", control: { kind: "text", placeholder: "Filter key hash" } }],
	key_alias: [{ key: "alias", label: "Key Alias", control: { kind: "text", placeholder: "Filter key alias" } }],
	team_alias: [
		{
			key: "team",
			label: "Team ID",
			control: {
				kind: "remote",
				placeholder: "Search teams…",
				initialOptions: teamChoices(""),
				search: async (term) => teamChoices(term),
			},
		},
	],
	organization_alias: [
		{
			key: "organization",
			label: "Organization ID",
			control: {
				kind: "remote",
				placeholder: "Search organizations…",
				initialOptions: organizationChoices(""),
				search: async (term) => organizationChoices(term),
			},
		},
	],
	user: [{ key: "user", label: "User ID", control: { kind: "text", placeholder: "Filter user ID" } }],
}));
const activeFilters = computed<UiTableActiveFilter[]>(() => {
	const filters = state.filters;
	const entries: UiTableActiveFilter[] = [];
	if (filters.hash) entries.push({ key: "hash", label: "Key Hash", value: filters.hash, text: filters.hash, match: "exact" });
	if (filters.alias) entries.push({ key: "alias", label: "Key Alias", value: filters.alias, text: filters.alias, match: "fuzzy" });
	if (filters.team) entries.push({ key: "team", label: "Team ID", value: filters.team, text: teamLabel(filters.team), match: "exact" });
	if (filters.organization)
		entries.push({
			key: "organization",
			label: "Organization ID",
			value: filters.organization,
			text: organizationLabel(filters.organization),
			match: "exact",
		});
	if (filters.user) entries.push({ key: "user", label: "User ID", value: filters.user, text: filters.user, match: "exact" });
	return entries;
});
function applyKeyFilters(entries: readonly UiTableActiveFilter[]): void {
	const next = { ...state.filters };
	for (const entry of entries) next[entry.key as keyof KeyFilters] = entry.value;
	void store.filter(next);
}
function removeKeyFilter(key: string): void {
	void store.filter({ ...state.filters, [key]: "" });
}
const pageCount = computed(() => Math.ceil(state.total / state.pageSize));
const range = computed(() => (state.page - 1) * state.pageSize + 1 + " - " + Math.min(state.page * state.pageSize, state.total));
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
							:filter-fields="filterFields"
							:active-filters="activeFilters"
							@select="select"
							@sort="store.sort"
							@filter-change="applyKeyFilters"
							@remove-filter="removeKeyFilter"
							@clear-filters="store.resetFilters"
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
