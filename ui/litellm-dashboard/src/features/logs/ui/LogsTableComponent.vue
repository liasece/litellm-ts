<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { LogEntry, LogsOptionalColumnId, LogsSortField, SessionGroupRef } from "../support/LogsModels";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import UiTable from "../../platform/ui/UiTable.vue";
import type { UiTableColumn, UiTableSort } from "../../platform/ui/UiTypes";
import { computeLogsColumnWidths } from "../logic/LogsTableLayoutLogic";
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
const host = ref<HTMLElement>();
const availableWidth = ref(0);
let hostObserver: ResizeObserver | undefined;
function measureHostWidth(): void {
	// 减去 UiTable 外框左右各 1px，避免算出的总宽比滚动视口多 2px。
	availableWidth.value = Math.max(0, Math.floor((host.value?.clientWidth ?? 0) - 2));
}
onMounted(() => {
	if (!host.value) return;
	measureHostWidth();
	if (typeof ResizeObserver === "undefined") return;
	hostObserver = new ResizeObserver(measureHostWidth);
	hostObserver.observe(host.value);
});
onBeforeUnmount(() => hostObserver?.disconnect());
const layout = computed(() => computeLogsColumnWidths(columns.value, availableWidth.value));
const columnWidths = computed(() => layout.value.widths);
const minWidth = computed(() => layout.value.totalWidth);
const tableColumns = computed<readonly UiTableColumn[]>(() =>
	columns.value.map((column: LogsColumn) => ({
		key: column.id,
		label: column.label,
		width: column.fixedWidth ?? column.minWidth,
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
	<div ref="host" class="logs-table-host">
		<UiTable
			class="logs-table"
			:columns="tableColumns"
			:rows="data"
			row-key="request_id"
			:loading="loading"
			loading-text="🚅 Loading logs..."
			fixed-layout
			manual-sort
			virtual
			:row-height="33"
			:overscan="8"
			:sort-by="sortBy"
			:sort-order="sortOrder"
			:min-width="minWidth"
			:column-widths="columnWidths"
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
	</div>
</template>
