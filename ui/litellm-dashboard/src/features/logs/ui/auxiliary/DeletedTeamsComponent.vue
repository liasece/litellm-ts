<script setup lang="ts">
import "./DeletedLogsStyles.css";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { createDeletedLogsStore } from "../../stores/DeletedLogsStore";
import { deletedTeamColumns } from "../../support/DeletedLogColumnModels";
import { filterRowsByFields } from "../../../platform/ui/UiTableFilterLogic";
import type { UiTableActiveFilter, UiTableFilterField } from "../../../platform/ui/UiTableFilterModels";
import DeletedRecordsTableComponent from "./DeletedRecordsTableComponent.vue";
const store = createDeletedLogsStore("teams");
const activeFilters = ref<UiTableActiveFilter[]>([]);
const filterFields = computed<Record<string, readonly UiTableFilterField[]>>(() => ({
	team_alias: [{ key: "team_alias", label: "Team Alias", control: { kind: "text", placeholder: "Filter team alias" } }],
	team_id: [{ key: "team_id", label: "Team ID", control: { kind: "text", placeholder: "Filter team ID" } }],
	organization_id: [{ key: "organization_id", label: "Organization", control: { kind: "text", placeholder: "Filter organization ID" } }],
	deleted_by: [{ key: "deleted_by", label: "Deleted By", control: { kind: "text", placeholder: "Filter deleted by" } }],
}));
const filteredRows = computed(() => filterRowsByFields(store.rows.value, activeFilters.value, (row, key) => row[key]));
function applyFilters(entries: readonly UiTableActiveFilter[]): void {
	const next = activeFilters.value.filter((filter) => !entries.some((entry) => entry.key === filter.key));
	for (const entry of entries) {
		if (entry.value.trim()) next.push({ ...entry, value: entry.value.trim(), text: entry.text || entry.value.trim() });
	}
	activeFilters.value = next;
}
function removeFilter(key: string): void {
	activeFilters.value = activeFilters.value.filter((filter) => filter.key !== key);
}
function clearFilters(): void {
	activeFilters.value = [];
}
onMounted(() => void store.load());
onBeforeUnmount(store.dispose);
</script>
<template>
	<div class="deleted-log-section">
		<div class="deleted-log-header">
			<span v-if="store.state.loading || store.state.fetching">Loading...</span
			><span v-else
				>Showing {{ filteredRows.length }} team{{ filteredRows.length === 1 ? "" : "s"
				}}<template v-if="activeFilters.length"> of {{ store.rows.value.length }}</template></span
			>
		</div>
		<DeletedRecordsTableComponent
			:rows="filteredRows"
			:columns="deletedTeamColumns"
			:loading="store.state.loading || store.state.fetching"
			kind="teams"
			:filter-fields="filterFields"
			:active-filters="activeFilters"
			@filter-change="applyFilters"
			@remove-filter="removeFilter"
			@clear-filters="clearFilters"
		/>
	</div>
</template>
