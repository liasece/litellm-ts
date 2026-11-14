<script setup lang="ts">
import { computed } from "vue";
import type { LogEntry, LogsOptionalColumnId, LogsSortField, SessionGroupRef } from "../support/LogsModels";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import UiTable from "../../platform/ui/UiTable.vue";
import type { UiTableColumn, UiTableSort } from "../../platform/ui/UiTypes";
import { logsColumns, type LogsColumn } from "../support/LogsColumnModels";
import LogsTableRowComponent from "./LogsTableRowComponent.vue";
const props = withDefaults(
	defineProps<{
		data: LogEntry[];
		loading: boolean;
		sortBy: LogsSortField;
		sortOrder: "asc" | "desc";
		visibleColumns?: LogsOptionalColumnId[];
		live: boolean;
		filterFields?: Partial<Record<string, readonly UiTableFilterField[]>>;
		activeFilters?: readonly UiTableActiveFilter[];
	}>(),
	{ visibleColumns: () => [], filterFields: () => ({}), activeFilters: () => [] },
);
const emit = defineEmits<{
	select: [log: LogEntry];
	key: [hash: string];
	session: [group: SessionGroupRef];
	sort: [field: LogsSortField, order: "asc" | "desc"];
	filterChange: [entries: readonly UiTableActiveFilter[]];
	removeFilter: [key: string];
	clearFilters: [];
}>();
const columns = computed(() => logsColumns(props.visibleColumns));
const width = computed(() => columns.value.reduce((sum, item) => sum + item.width, 0));
const tableColumns = computed<readonly UiTableColumn[]>(() =>
	columns.value.map((column: LogsColumn) => ({
		key: column.id,
		label: column.label,
		width: column.width,
		sortable: Boolean(column.sort),
		initialSortOrder: "desc" as const,
		filters: props.filterFields[column.id],
	})),
);
const emptyText = computed(() => (props.activeFilters.length ? "No logs match the current filters" : "No logs found"));
function logRow(row: Record<string, unknown>): LogEntry {
	return row as unknown as LogEntry;
}
function changeSort(sort: UiTableSort): void {
	if (sort.order) emit("sort", sort.key as LogsSortField, sort.order);
	else emit("sort", "startTime", "desc");
}
</script>
<template>
	<UiTable
		:columns="tableColumns"
		:rows="data"
		row-key="request_id"
		:loading="loading"
		loading-text="🚅 Loading logs..."
		fixed-layout
		manual-sort
		:sort-by="sortBy"
		:sort-order="sortOrder"
		:min-width="width"
		:active-filters="activeFilters"
		:empty-text="emptyText"
		@sort="changeSort"
		@filter-change="emit('filterChange', $event)"
		@remove-filter="emit('removeFilter', $event)"
		@clear-filters="emit('clearFilters')"
	>
		<template #row="{ row, index }">
			<LogsTableRowComponent
				:key="logRow(row).request_id || index"
				:log="logRow(row)"
				:columns="columns"
				:live="live"
				@select="emit('select', $event)"
				@key="emit('key', $event)"
				@session="emit('session', $event)"
			/>
		</template>
	</UiTable>
</template>
