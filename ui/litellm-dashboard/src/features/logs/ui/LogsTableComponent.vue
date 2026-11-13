<script setup lang="ts">
import { computed, ref } from "vue";
import type { LogEntry, LogsOptionalColumnId, LogsSortField, SessionGroupRef } from "../support/LogsModels";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import UiActiveFilters from "../../platform/ui/UiActiveFilters.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import UiTableFilterPanel from "../../platform/ui/UiTableFilterPanel.vue";
import type { UiTableColumn, UiTableSort } from "../../platform/ui/UiTypes";
import { logsColumns, type LogsColumn } from "../support/LogsColumnModels";
import LogsMobileCardComponent from "./LogsMobileCardComponent.vue";
import LogsTableRowComponent from "./LogsTableRowComponent.vue";
import { useCompactViewport } from "../../platform/logic/CompactViewport";
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
const compact = useCompactViewport();
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
/** 卡片没有表头，排序值按列定义生成，保证手机上任一可排序字段都能切换。 */
const sortValue = computed(() => props.sortBy + ":" + props.sortOrder);
const sortLabels: Partial<Record<LogsSortField, [string, string]>> = {
	startTime: ["Time newest", "Time oldest"],
	spend: ["Cost highest", "Cost lowest"],
	request_duration_ms: ["Duration longest", "Duration shortest"],
	total_tokens: ["Tokens most", "Tokens fewest"],
};
const sortOptions = computed(() =>
	columns.value
		.filter((column) => column.sort)
		.flatMap((column) => {
			const field = column.sort;
			if (!field) return [];
			const labels = sortLabels[field] ?? [column.label + " ↓", column.label + " ↑"];
			return [
				{ value: field + ":desc", label: labels[0] },
				{ value: field + ":asc", label: labels[1] },
			];
		}),
);
/** 表头筛选按钮在卡片模式下不可见，这里把各列的筛选字段合并成同一张面板。 */
const mobileFilterFields = computed<readonly UiTableFilterField[]>(() => {
	const seen = new Set<string>();
	const fields: UiTableFilterField[] = [];
	for (const column of columns.value)
		for (const field of props.filterFields[column.id] ?? []) {
			if (seen.has(field.key)) continue;
			seen.add(field.key);
			fields.push(field);
		}
	return fields;
});
const filterOpen = ref(false);
function changeMobileSort(event: Event): void {
	const [field, order] = (event.target as HTMLSelectElement).value.split(":") as [LogsSortField, "asc" | "desc"];
	emit("sort", field, order);
}
function applyMobileFilters(entries: UiTableActiveFilter[]): void {
	emit("filterChange", entries);
	filterOpen.value = false;
}
function logRow(row: Record<string, unknown>): LogEntry {
	return row as unknown as LogEntry;
}
function changeSort(sort: UiTableSort): void {
	if (sort.order) emit("sort", sort.key as LogsSortField, sort.order);
	else emit("sort", "startTime", "desc");
}
</script>
<template>
	<div v-if="compact" class="logs-mobile-table">
		<div v-if="sortOptions.length || mobileFilterFields.length" class="logs-mobile-controls">
			<label v-if="sortOptions.length" class="logs-mobile-control">
				<span class="logs-mobile-control__label">Sort</span>
				<select class="logs-native-select logs-mobile-sort" :value="sortValue" aria-label="Sort logs" @change="changeMobileSort">
					<option v-for="option in sortOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
				</select>
			</label>
			<button v-if="mobileFilterFields.length" type="button" class="logs-native-button logs-mobile-filter" @click="filterOpen = true">
				Filters
				<span v-if="activeFilters.length" class="logs-mobile-filter__count">{{ activeFilters.length }}</span>
			</button>
		</div>
		<UiActiveFilters
			v-if="activeFilters.length"
			:filters="activeFilters"
			@remove="emit('removeFilter', $event)"
			@clear="emit('clearFilters')"
		/>
		<div v-if="loading" class="logs-mobile-state">🚅 Loading logs...</div>
		<div v-else-if="!data.length" class="logs-mobile-state">{{ emptyText }}</div>
		<div v-else class="logs-mcard-list">
			<LogsMobileCardComponent
				v-for="(row, index) in data"
				:key="logRow(row).request_id || index"
				:log="logRow(row)"
				:columns="columns"
				@select="emit('select', $event)"
				@key="emit('key', $event)"
				@session="emit('session', $event)"
			/>
		</div>
		<UiDialog v-model:open="filterOpen" class="logs-filter-dialog" title="Filter logs" aria-label="Filter logs" :show-footer="false">
			<UiTableFilterPanel
				v-if="filterOpen"
				class="logs-filter-panel"
				label="Logs"
				:fields="mobileFilterFields"
				:active="activeFilters"
				@commit="applyMobileFilters"
				@cancel="filterOpen = false"
			/>
		</UiDialog>
	</div>
	<UiTable
		v-else
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
