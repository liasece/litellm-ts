<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import UiActiveFilters from "./UiActiveFilters.vue";
import UiCheckbox from "./UiCheckbox.vue";
import UiHeaderFilterButton from "./UiHeaderFilterButton.vue";
import UiIcon from "./UiIcon.vue";
import UiPopover from "./UiPopover.vue";
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
		/** 列表数据区加载时显示的状态行文案；默认使用通用 Loading。 */
		loadingText?: string;
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
		/** 选择框的无障碍名称；用于保留“Select 名称”这类业务语义。 */
		selectionLabel?: (row: UiTableRow, index: number) => string;
		selectedKeys?: readonly (string | number)[];
		emptyText?: string;
		/** 整行可点击打开详情：仅影响指针/悬停提示，点击事件始终按 rowClick 发出。 */
		rowClickable?: boolean;
		/** 固定列宽布局；声明了数值宽度的列表使用它保持列宽不被内容撑开。 */
		fixedLayout?: boolean;
		/** 允许拖拽表头分隔线调整列宽；列宽由调用方持久化时传入 columnWidths。 */
		resizable?: boolean;
		/** 排序是否允许通过再次点击取消；默认允许。 */
		sortClearable?: boolean;
		columnWidths?: Readonly<Record<string, number>>;
	}>(),
	{
		bodyMaxHeight: undefined,
		minWidth: undefined,
		selection: undefined,
		selectionLabel: undefined,
		sortBy: undefined,
		sortOrder: "asc",
		rowKey: "id",
		appearance: "antd",
		selectedKeys: () => [],
		activeFilters: () => [],
		emptyText: "No data",
		rowClickable: false,
		fixedLayout: false,
		resizable: false,
		sortClearable: true,
		columnWidths: undefined,
		loadingText: undefined,
	},
);
const emit = defineEmits<{
	sort: [sort: UiTableSort];
	rowClick: [row: UiTableRow, index: number];
	"update:selectedKeys": [keys: (string | number)[]];
	"update:columnWidths": [widths: Record<string, number>];
	columnResize: [key: string, width: number];
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
onBeforeUnmount(() => {
	headerObserver?.disconnect();
	stopResize();
});
const scrollStyle = computed(() =>
	props.bodyMaxHeight == null ? undefined : { maxHeight: headerHeight.value + Math.max(0, props.bodyMaxHeight) + "px" },
);
const internalSort = ref<UiTableSort>({ key: "", order: null });
const effectiveSort = computed<UiTableSort>(() => (props.sortBy ? { key: props.sortBy, order: props.sortOrder } : internalSort.value));
const visibleRows = computed(() => (props.manualSort ? props.rows : sortTableRows(props.rows, props.columns, effectiveSort.value)));
const emptyDescription = computed(() => (props.activeFilters.length ? "No records match the current filters" : props.emptyText));
const internalWidths = reactive<Record<string, number>>({});
function columnWidth(column: UiTableColumn): number | undefined {
	return props.columnWidths?.[column.key] ?? internalWidths[column.key] ?? (typeof column.width === "number" ? column.width : undefined);
}
const numericWidth = computed(() =>
	props.columns.every((column) => columnWidth(column) != null)
		? props.columns.reduce((total, column) => total + (columnWidth(column) ?? 0), 0)
		: undefined,
);
const tableMinWidth = computed(() => {
	if (typeof props.minWidth === "number") return Math.max(props.minWidth, numericWidth.value ?? 0);
	if (typeof props.minWidth === "string") return props.minWidth;
	return numericWidth.value;
});
const colspan = computed(() => props.columns.length + (props.selection ? 1 : 0));
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
let resizing: { key: string; startX: number; startWidth: number; maxWidth: number } | null = null;
function updateWidth(key: string, width: number) {
	const next = Math.max(40, Math.min(resizing?.maxWidth ?? 600, Math.round(width)));
	if (!props.columnWidths) internalWidths[key] = next;
	emit("columnResize", key, next);
	emit("update:columnWidths", { ...(props.columnWidths ?? {}), [key]: next });
}
function beginResize(event: PointerEvent, column: UiTableColumn) {
	if (!props.resizable) return;
	event.preventDefault();
	event.stopPropagation();
	const th = (event.currentTarget as HTMLElement).closest("th");
	resizing = {
		key: column.key,
		startX: event.clientX,
		startWidth: columnWidth(column) ?? th?.getBoundingClientRect().width ?? 120,
		maxWidth: column.maxWidth ?? 600,
	};
	document.addEventListener("pointermove", moveResize);
	document.addEventListener("pointerup", stopResize, { once: true });
}
function moveResize(event: PointerEvent) {
	if (!resizing) return;
	updateWidth(resizing.key, resizing.startWidth + event.clientX - resizing.startX);
}
function stopResize() {
	resizing = null;
	document.removeEventListener("pointermove", moveResize);
	document.removeEventListener("pointerup", stopResize);
}
function resetWidth(column: UiTableColumn) {
	if (typeof column.width !== "number") return;
	if (!props.columnWidths) delete internalWidths[column.key];
	emit("columnResize", column.key, column.width);
	emit("update:columnWidths", { ...(props.columnWidths ?? {}), [column.key]: column.width });
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
		<div class="ui-table-frame">
			<div class="ui-table-scroll" :style="scrollStyle">
				<table
					class="ui-table"
					:class="{ 'ui-table--sticky': stickyHeader, 'ui-table--fixed': fixedLayout }"
					:style="{ minWidth: typeof tableMinWidth === 'number' ? tableMinWidth + 'px' : tableMinWidth }"
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
								:class="{
									'ui-table__cell--ellipsis': column.ellipsis,
									'ui-table__cell--sticky-right': column.sticky === 'right',
								}"
								:style="{
									width: columnWidth(column) == null ? column.width : columnWidth(column) + 'px',
									maxWidth: column.maxWidth == null ? undefined : column.maxWidth + 'px',
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
										:allow-clear="sortClearable"
										@change="changeSort(column, $event)"
									>
										<slot :name="'header-' + column.key" :column="column">{{ column.label }}</slot>
									</UiTableSortLabel>
									<span v-else class="ui-table__header-label"
										><slot :name="'header-' + column.key" :column="column">{{ column.label }}</slot></span
									>
									<UiPopover v-if="column.tooltip" :content="column.tooltip"
										><UiIcon name="InfoCircleOutlined" class="ui-table__info"
									/></UiPopover>
									<UiHeaderFilterButton
										v-if="column.filters?.length"
										:label="column.label"
										:fields="column.filters"
										:active="filtersForColumn(column)"
										@change="emit('filterChange', $event)"
									/>
								</div>
								<span
									v-if="resizable"
									class="ui-table__resizer"
									aria-hidden="true"
									@pointerdown="beginResize($event, column)"
									@click.stop
									@dblclick.stop="resetWidth(column)"
								/>
							</th>
						</tr>
					</thead>
					<tbody>
						<tr v-if="loading" class="ui-table__state">
							<td :colspan="colspan">
								<slot name="loading">{{ loadingText ?? "Loading..." }}</slot>
							</td>
						</tr>
						<template v-else-if="$slots.row">
							<slot v-for="(row, index) in visibleRows" :key="keyForRow(row, index)" name="row" :row="row" :index="index" />
						</template>
						<template v-else>
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
										:label="selectionLabel ? selectionLabel(row, index) : 'Select row ' + (index + 1)"
										@update:model-value="selectRow(keyForRow(row, index), $event)"
									/>
								</td>
								<td
									v-for="column in columns"
									:key="column.key"
									:class="[
										column.cellClass,
										{
											'ui-table__cell--ellipsis': column.ellipsis,
											'ui-table__cell--sticky-right': column.sticky === 'right',
										},
									]"
									:style="{ textAlign: column.align }"
								>
									<slot :name="'cell-' + column.key" :row="row" :value="readTableValue(row, column)" :index="index">{{
										displayTableValue(readTableValue(row, column))
									}}</slot>
								</td>
							</tr>
						</template>
						<tr v-if="!loading && !visibleRows.length" class="ui-table__state">
							<td :colspan="colspan">
								<slot name="empty">{{ emptyDescription }}</slot>
							</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	</div>
</template>
