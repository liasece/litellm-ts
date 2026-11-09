<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import VirtualKeysTableComponent from "../../virtual-keys/ui/VirtualKeysTableComponent.vue";
import KeyDetailDrawerComponent from "../../virtual-keys/ui/KeyDetailDrawerComponent.vue";
import UiPagination from "../../platform/ui/UiPagination.vue";
import AccessNoticeComponent from "./AccessNoticeComponent.vue";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import { createVirtualKeysStore, emptyKeyFilters } from "../../virtual-keys/stores/VirtualKeysStore";
import { emptyKeyCatalog, type KeyFilters, type VirtualKey } from "../../virtual-keys/support/VirtualKeyModels";
import type { AccessTeam } from "../support/AccessModels";
const props = defineProps<{ team: AccessTeam }>();
const store = createVirtualKeysStore(),
	{ state } = store,
	catalog = shallowRef(emptyKeyCatalog()),
	selected = ref<VirtualKey | null>(null),
	detailOpen = ref(false);
state.filters.team = props.team.team_id;
const filterFields = computed<Record<string, readonly UiTableFilterField[]>>(() => ({
	key_alias: [{ key: "alias", label: "Key Alias", control: { kind: "text", placeholder: "Filter key alias" } }],
	organization_alias: [
		{ key: "organization", label: "Organization ID", control: { kind: "text", placeholder: "Filter organization ID" } },
	],
	user_id: [{ key: "user", label: "User ID", control: { kind: "text", placeholder: "Filter user ID" } }],
}));
const activeFilters = computed<UiTableActiveFilter[]>(() => {
	const filters = state.filters;
	const entries: UiTableActiveFilter[] = [];
	if (filters.organization)
		entries.push({
			key: "organization",
			label: "Organization ID",
			value: filters.organization,
			text: filters.organization,
			match: "exact",
		});
	if (filters.alias) entries.push({ key: "alias", label: "Key Alias", value: filters.alias, text: filters.alias, match: "fuzzy" });
	if (filters.user) entries.push({ key: "user", label: "User ID", value: filters.user, text: filters.user, match: "exact" });
	return entries;
});
function applyFilters(entries: readonly UiTableActiveFilter[]): void {
	const next: KeyFilters = { ...emptyKeyFilters(), team: props.team.team_id };
	for (const entry of entries) next[entry.key as keyof KeyFilters] = entry.value;
	void store.filter(next);
}
function removeFilter(key: string): void {
	void store.filter({ ...state.filters, [key]: "" });
}
function clearFilters(): void {
	void store.filter({ ...emptyKeyFilters(), team: props.team.team_id });
}
function select(key: VirtualKey) {
	selected.value = key;
	detailOpen.value = true;
}
onMounted(() => {
	void store.refresh();
	void store.catalog(props.team.team_id).then((value) => {
		catalog.value = value;
	});
	window.addEventListener("storage", store.refresh);
});
onBeforeUnmount(() => {
	window.removeEventListener("storage", store.refresh);
	store.dispose();
});
</script>
<template>
	<section class="access-team-keys">
		<AccessNoticeComponent :error="state.error" :message="state.message" />
		<UiPagination
			:model-value="state.page"
			:total="state.total"
			:page-size="50"
			@change="store.page($event)"
		/><VirtualKeysTableComponent
			:rows="state.rows"
			:catalog="catalog"
			:loading="state.loading"
			:sort-by="state.sortBy"
			:sort-order="state.sortOrder"
			:can-modify="() => false"
			:pending-token="state.pendingToken"
			scope="team"
			:filter-fields="filterFields"
			:active-filters="activeFilters"
			@select="select"
			@sort="store.sort"
			@filter-change="applyFilters"
			@remove-filter="removeFilter"
			@clear-filters="clearFilters"
		/><KeyDetailDrawerComponent
			v-model:open="detailOpen"
			:key-data="selected"
			:catalog="catalog"
			@updated="store.refresh"
			@deleted="store.refresh"
		/>
	</section>
</template>
