<script setup lang="ts">
import "./DeletedLogsStyles.css";
import { computed, onBeforeUnmount, onMounted } from "vue";
import { createDeletedLogsStore } from "../../stores/DeletedLogsStore";
import { deletedKeyColumns } from "../../support/DeletedLogColumnModels";
import type { DeletedKeyFilters } from "../../support/DeletedLogFilterModels";
import type { UiTableActiveFilter, UiTableFilterChoice, UiTableFilterField } from "../../../platform/ui/UiTableFilterModels";
import { useApplicationStore } from "../../../application/stores/ApplicationStore";
import DeletedRecordsTableComponent from "./DeletedRecordsTableComponent.vue";
const store = createDeletedLogsStore("keys");
const application = useApplicationStore();
function teamLabel(id: string): string {
	const team = application.state.teams.find((item) => item.team_id === id);
	return team?.team_alias || id;
}
function teamChoices(term: string): UiTableFilterChoice[] {
	const query = term.trim().toLowerCase();
	return application.state.teams.flatMap((team) => {
		const alias = typeof team.team_alias === "string" ? team.team_alias : "";
		if (query && !team.team_id.toLowerCase().includes(query) && !alias.toLowerCase().includes(query)) return [];
		return [{ value: team.team_id, label: alias || team.team_id, description: alias ? team.team_id : undefined }];
	});
}
const filterFields = computed<Record<string, readonly UiTableFilterField[]>>(() => ({
	token: [{ key: "key_hash", label: "Key Hash", control: { kind: "text", placeholder: "Filter key hash" } }],
	key_alias: [{ key: "key_alias", label: "Key Alias", control: { kind: "text", placeholder: "Filter key alias" } }],
	team_alias: [
		{
			key: "team_id",
			label: "Team ID",
			control: {
				kind: "remote",
				placeholder: "Search teams…",
				initialOptions: teamChoices(""),
				search: async (term) => teamChoices(term),
			},
		},
	],
	user_id: [{ key: "user_id", label: "User ID", control: { kind: "text", placeholder: "Filter user ID" } }],
}));
const activeFilters = computed<UiTableActiveFilter[]>(() => {
	const filters = store.state.filters;
	const entries: UiTableActiveFilter[] = [];
	if (filters.key_hash)
		entries.push({ key: "key_hash", label: "Key Hash", value: filters.key_hash, text: filters.key_hash, match: "exact" });
	if (filters.key_alias)
		entries.push({ key: "key_alias", label: "Key Alias", value: filters.key_alias, text: filters.key_alias, match: "fuzzy" });
	if (filters.team_id)
		entries.push({ key: "team_id", label: "Team ID", value: filters.team_id, text: teamLabel(filters.team_id), match: "exact" });
	if (filters.user_id) entries.push({ key: "user_id", label: "User ID", value: filters.user_id, text: filters.user_id, match: "exact" });
	return entries;
});
function applyFilters(entries: readonly UiTableActiveFilter[]): void {
	const next: Partial<DeletedKeyFilters> = {};
	for (const entry of entries) next[entry.key as keyof DeletedKeyFilters] = entry.value;
	store.applyFilters(next);
}
function removeFilter(key: string): void {
	store.applyFilters({ [key]: "" } as Partial<DeletedKeyFilters>);
}
onMounted(() => void store.load());
onBeforeUnmount(store.dispose);
</script>
<template>
	<div class="deleted-log-section">
		<div class="deleted-log-header">
			<span v-if="store.state.loading || store.state.fetching">Loading...</span
			><span v-else
				>Showing {{ (store.state.page - 1) * 50 + 1 }} - {{ Math.min(store.state.page * 50, store.state.total) }} of
				{{ store.state.total }} results</span
			>
			<div class="deleted-log-pages">
				<span v-if="store.state.loading || store.state.fetching">Loading...</span
				><span v-else>Page {{ store.state.page }} of {{ store.pages.value }}</span
				><button
					class="logs-native-button"
					:disabled="store.state.loading || store.state.fetching || store.state.page === 1"
					@click="store.page(store.state.page - 1)"
				>
					Previous</button
				><button
					class="logs-native-button"
					:disabled="store.state.loading || store.state.fetching || store.state.page >= store.pages.value"
					@click="store.page(store.state.page + 1)"
				>
					Next
				</button>
			</div>
		</div>
		<DeletedRecordsTableComponent
			:rows="store.rows.value"
			:columns="deletedKeyColumns"
			:loading="store.state.loading || store.state.fetching"
			kind="keys"
			:filter-fields="filterFields"
			:active-filters="activeFilters"
			@filter-change="applyFilters"
			@remove-filter="removeFilter"
			@clear-filters="store.clearFilters"
		/>
	</div>
</template>
