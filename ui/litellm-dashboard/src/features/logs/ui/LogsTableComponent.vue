<script setup lang="ts">
import { computed } from "vue";
import type { LogEntry, LogsOptionalColumnId, LogsSortField, SessionGroupRef } from "../support/LogsModels";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import UiActiveFilters from "../../platform/ui/UiActiveFilters.vue";
import UiHeaderFilterButton from "../../platform/ui/UiHeaderFilterButton.vue";
import UiTableSortLabel from "../../platform/ui/UiTableSortLabel.vue";
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
const emptyText = computed(() => (props.activeFilters.length ? "No logs match the current filters" : "No logs found"));

function sortState(column: LogsColumn): "asc" | "desc" | false {
	return column.sort && props.sortBy === column.sort ? props.sortOrder : false;
}
function ariaSort(column: LogsColumn): "ascending" | "descending" | "none" | undefined {
	if (!column.sort) return undefined;
	if (props.sortBy !== column.sort) return "none";
	return props.sortOrder === "asc" ? "ascending" : "descending";
}
function changeSort(column: LogsColumn, order: "asc" | "desc" | false): void {
	if (!column.sort) return;
	// 日志列表始终保留一个排序字段，取消排序时回到默认的最新优先。
	if (order) emit("sort", column.sort, order);
	else emit("sort", "startTime", "desc");
}
function filtersForColumn(id: string): readonly UiTableActiveFilter[] {
	const keys = new Set((props.filterFields[id] ?? []).map((field) => field.key));
	return props.activeFilters.filter((filter) => keys.has(filter.key));
}
</script>
<template>
	<UiActiveFilters
		v-if="activeFilters.length"
		:filters="activeFilters"
		@remove="emit('removeFilter', $event)"
		@clear="emit('clearFilters')"
	/>
	<div class="logs-table-wrap">
		<table class="logs-table" :style="{ minWidth: width + 'px' }">
			<thead>
				<tr>
					<th v-for="column in columns" :key="column.id" :style="{ width: column.width + 'px' }" :aria-sort="ariaSort(column)">
						<div class="logs-table-heading">
							<UiTableSortLabel
								v-if="column.sort"
								:label="column.label"
								:state="sortState(column)"
								initial="desc"
								@change="changeSort(column, $event)"
							/>
							<span v-else class="logs-table-heading__label">{{ column.label }}</span>
							<UiHeaderFilterButton
								v-if="filterFields[column.id]?.length"
								:label="column.label"
								:fields="filterFields[column.id] ?? []"
								:active="filtersForColumn(column.id)"
								@change="emit('filterChange', $event)"
							/>
						</div>
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-if="loading" class="logs-empty">
					<td :colspan="columns.length">🚅 Loading logs...</td>
				</tr>
				<LogsTableRowComponent
					v-for="log in loading ? [] : data"
					:key="log.request_id"
					:log="log"
					:columns="columns"
					:live="live"
					@select="emit('select', $event)"
					@key="emit('key', $event)"
					@session="emit('session', $event)"
				/>
				<tr v-if="!loading && data.length === 0" class="logs-empty">
					<td :colspan="columns.length">{{ emptyText }}</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>
