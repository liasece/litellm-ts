<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import UiActiveFilters from "./UiActiveFilters.vue";
import UiCheckbox from "./UiCheckbox.vue";
import UiEmptyState from "./UiEmptyState.vue";
import UiHeaderFilterButton from "./UiHeaderFilterButton.vue";
import UiSpinner from "./UiSpinner.vue";
import UiTableSortLabel from "./UiTableSortLabel.vue";
import { displayTableValue, readTableValue, sortTableRows } from "./UiTableLogic";
import { isTableRowInteractiveTarget } from "../logic/TableRowClick";
import type { UiTableActiveFilter } from "./UiTableFilterModels";
import type { UiAppearance, UiTableColumn, UiTableRow, UiSortOrder, UiTableSort } from "./UiTypes";

const props = withDefaults(
	defineProps<{
		columns: readonly UiTableColumn[];
		rows: readonly UiTableRow[];
		rowKey?: string | ((row: UiTableRow) => string | number);
		appearance?: UiAppearance;
		loading?: boolean;
		compact?: boolean;
		minWidth?: string | number;
		stickyHeader?: boolean;
		bodyMaxHeight?: number;
		manualSort?: boolean;
		/** 受控排序列；传入后排序状态由调用方维护，表格只发出 sort 事件。 */
		sortBy?: string;
		sortOrder?: "asc" | "desc";
		/** 已生效的筛选条件；表格负责渲染表头激活态和可关闭的筛选标签。 */
		activeFilters?: readonly UiTableActiveFilter[];
		selection?: "single" | "multiple";
		selectedKeys?: readonly (string | number)[];
		emptyText?: string;
		/** 整行可点击打开详情：仅影响指针/悬停提示，点击事件始终按 rowClick 发出。 */
		rowClickable?: boolean;
	}>(),
	{
		bodyMaxHeight: undefined,
		minWidth: undefined,
		selection: undefined,
		sortBy: undefined,
		sortOrder: "asc",
		rowKey: "id",
		appearance: "antd",
		selectedKeys: () => [],
		activeFilters: () => [],
		emptyText: "No data",
		rowClickable: false,
	},
);
const emit = defineEmits<{
	sort: [sort: UiTableSort];
	rowClick: [row: UiTableRow, index: number];
	"update:selectedKeys": [keys: (string | number)[]];
	filterChange: [entries: readonly UiTableActiveFilter[]];
	removeFilter: [key: string];
	clearFilters: [];
}>();
const header = ref<HTMLTableSectionElement>();
const headerHeight = ref(0);
let headerObserver: ResizeObserver | undefined;
watch(
	[header, () => props.bodyMaxHeight],
	() => {
		headerObserver?.disconnect();
		if (!header.value || props.bodyMaxHeight == null) return;
		const measure = () => {
			headerHeight.value = header.value?.getBoundingClientRect().height ?? 0;
		};
		measure();
		headerObserver = new ResizeObserver(measure);
		headerObserver.observe(header.value);
	},
	{ flush: "post" },
);
onBeforeUnmount(() => headerObserver?.disconnect());
const scrollStyle = computed(() =>
	props.bodyMaxHeight == null ? undefined : { maxHeight: headerHeight.value + Math.max(0, props.bodyMaxHeight) + "px" },
);
const internalSort = ref<UiTableSort>({ key: "", order: null });
const effectiveSort = computed<UiTableSort>(() => (props.sortBy ? { key: props.sortBy, order: props.sortOrder } : internalSort.value));
const visibleRows = computed(() => (props.manualSort ? props.rows : sortTableRows(props.rows, props.columns, effectiveSort.value)));
const emptyDescription = computed(() => (props.activeFilters.length ? "No records match the current filters" : props.emptyText));
function keyForRow(row: UiTableRow, index: number): string | number {
	const key = typeof props.rowKey === "function" ? props.rowKey(row) : row[props.rowKey];
	return typeof key === "string" || typeof key === "number" ? key : index;
}
const rowKeys = computed(() => visibleRows.value.map(keyForRow));
const allSelected = computed(() => rowKeys.value.length > 0 && rowKeys.value.every((key) => props.selectedKeys.includes(key)));
const someSelected = computed(() => rowKeys.value.some((key) => props.selectedKeys.includes(key)));
function sortState(column: UiTableColumn): UiSortOrder {
	return effectiveSort.value.key === column.key ? effectiveSort.value.order : null;
}
function sortColumn(column: UiTableColumn, order: UiSortOrder) {
	if (!column.sortable) return;
	if (!props.sortBy) internalSort.value = { key: column.key, order };
	emit("sort", { key: column.key, order });
}
function changeSort(column: UiTableColumn, order: "asc" | "desc" | false): void {
	sortColumn(column, order === false ? null : order);
}
function filtersForColumn(column: UiTableColumn): readonly UiTableActiveFilter[] {
	const keys = new Set((column.filters ?? []).map((field) => field.key));
	return props.activeFilters.filter((filter) => keys.has(filter.key));
}
function selectRow(key: string | number, checked: boolean) {
	if (props.selection === "single") emit("update:selectedKeys", checked ? [key] : []);
	else
		emit(
			"update:selectedKeys",
			checked ? [...new Set([...props.selectedKeys, key])] : props.selectedKeys.filter((selected) => selected !== key),
		);
}
function selectAll(checked: boolean) {
	emit(
		"update:selectedKeys",
		checked
			? [...new Set([...props.selectedKeys, ...rowKeys.value])]
			: props.selectedKeys.filter((key) => !rowKeys.value.includes(key)),
	);
}
function clickRow(event: MouseEvent, row: UiTableRow, index: number): void {
	if (isTableRowInteractiveTarget(event)) return;
	emit("rowClick", row, index);
}
function ariaSort(column: UiTableColumn): "ascending" | "descending" | "none" | undefined {
	if (!column.sortable) return undefined;
	const state = sortState(column);
	return state === "asc" ? "ascending" : state === "desc" ? "descending" : "none";
}
</script>

<template>
	<div
		class="ui-table-wrapper"
		:class="['ui-table-wrapper--' + appearance, { 'ui-table-wrapper--compact': compact }]"
		:aria-busy="loading || undefined"
	>
		<UiActiveFilters
			v-if="activeFilters.length"
			:filters="activeFilters"
			@remove="emit('removeFilter', $event)"
			@clear="emit('clearFilters')"
		/>
		<div class="ui-table-scroll" :style="scrollStyle">
			<table
				class="ui-table"
				:class="{ 'ui-table--sticky': stickyHeader }"
				:style="{ minWidth: typeof minWidth === 'number' ? minWidth + 'px' : minWidth }"
			>
				<thead ref="header">
					<tr>
						<th v-if="selection" scope="col" class="ui-table__selection">
							<UiCheckbox
								v-if="selection === 'multiple'"
								:model-value="allSelected"
								:indeterminate="someSelected && !allSelected"
								label="Select all rows"
								@update:model-value="selectAll"
							/>
						</th>
						<th
							scope="col"
							v-for="column in columns"
							:key="column.key"
							:style="{
								width: typeof column.width === 'number' ? column.width + 'px' : column.width,
								textAlign: column.align,
							}"
							:aria-sort="ariaSort(column)"
						>
							<div class="ui-table__header">
								<UiTableSortLabel
									v-if="column.sortable"
									:label="column.label"
									:state="sortState(column) ?? false"
									:initial="column.initialSortOrder ?? 'asc'"
									@change="changeSort(column, $event)"
								>
									<slot :name="'header-' + column.key" :column="column">{{ column.label }}</slot>
								</UiTableSortLabel>
								<span v-else class="ui-table__header-label"
									><slot :name="'header-' + column.key" :column="column">{{ column.label }}</slot></span
								>
								<UiHeaderFilterButton
									v-if="column.filters?.length"
									:label="column.label"
									:fields="column.filters"
									:active="filtersForColumn(column)"
									@change="emit('filterChange', $event)"
								/>
							</div>
						</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="(row, index) in visibleRows"
						:key="keyForRow(row, index)"
						class="ui-table__row"
						:class="{
							'ui-table__row--selected': selectedKeys.includes(keyForRow(row, index)),
							'ui-table__row--clickable': rowClickable,
						}"
						@click="clickRow($event, row, index)"
					>
						<td v-if="selection" class="ui-table__selection" @click.stop>
							<UiCheckbox
								:model-value="selectedKeys.includes(keyForRow(row, index))"
								:label="'Select row ' + (index + 1)"
								@update:model-value="selectRow(keyForRow(row, index), $event)"
							/>
						</td>
						<td
							v-for="column in columns"
							:key="column.key"
							:class="{ 'ui-table__cell--ellipsis': column.ellipsis }"
							:style="{ textAlign: column.align }"
						>
							<slot :name="'cell-' + column.key" :row="row" :value="readTableValue(row, column)" :index="index">{{
								displayTableValue(readTableValue(row, column))
							}}</slot>
						</td>
					</tr>
					<tr v-if="!visibleRows.length">
						<td :colspan="columns.length + (selection ? 1 : 0)" class="ui-table__empty">
							<slot name="empty"><UiEmptyState :description="emptyDescription" compact /></slot>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
		<div v-if="loading" class="ui-table__loading"><UiSpinner :size="28" /></div>
	</div>
</template>
