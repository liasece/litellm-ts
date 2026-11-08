<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import UiCheckbox from "./UiCheckbox.vue";
import UiEmptyState from "./UiEmptyState.vue";
import UiSpinner from "./UiSpinner.vue";
import { displayTableValue, readTableValue, sortTableRows } from "./UiTableLogic";
import type { UiAppearance, UiTableColumn, UiTableRow, UiTableSort } from "./UiTypes";

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
		selection?: "single" | "multiple";
		selectedKeys?: readonly (string | number)[];
		emptyText?: string;
	}>(),
	{
		bodyMaxHeight: undefined,
		minWidth: undefined,
		selection: undefined,
		rowKey: "id",
		appearance: "antd",
		selectedKeys: () => [],
		emptyText: "No data",
	},
);
const emit = defineEmits<{
	sort: [sort: UiTableSort];
	rowClick: [row: UiTableRow, index: number];
	"update:selectedKeys": [keys: (string | number)[]];
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
const sort = ref<UiTableSort>({ key: "", order: null });
const visibleRows = computed(() => (props.manualSort ? props.rows : sortTableRows(props.rows, props.columns, sort.value)));
function keyForRow(row: UiTableRow, index: number): string | number {
	const key = typeof props.rowKey === "function" ? props.rowKey(row) : row[props.rowKey];
	return typeof key === "string" || typeof key === "number" ? key : index;
}
const rowKeys = computed(() => visibleRows.value.map(keyForRow));
const allSelected = computed(() => rowKeys.value.length > 0 && rowKeys.value.every((key) => props.selectedKeys.includes(key)));
const someSelected = computed(() => rowKeys.value.some((key) => props.selectedKeys.includes(key)));
function sortColumn(column: UiTableColumn) {
	if (!column.sortable) return;
	sort.value = {
		key: column.key,
		order: sort.value.key !== column.key || sort.value.order === null ? "asc" : sort.value.order === "asc" ? "desc" : null,
	};
	emit("sort", sort.value);
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
function ariaSort(column: UiTableColumn): "ascending" | "descending" | "none" | undefined {
	if (!column.sortable) return undefined;
	return sort.value.key !== column.key || sort.value.order === null ? "none" : sort.value.order === "asc" ? "ascending" : "descending";
}
</script>

<template>
	<div
		class="ui-table-wrapper"
		:class="['ui-table-wrapper--' + appearance, { 'ui-table-wrapper--compact': compact }]"
		:aria-busy="loading || undefined"
	>
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
							<button v-if="column.sortable" type="button" class="ui-table__sort" @click="sortColumn(column)">
								<slot :name="'header-' + column.key" :column="column">{{ column.label }}</slot
								><span class="ui-table__sort-arrows" aria-hidden="true"
									><span :class="{ 'is-active': sort.key === column.key && sort.order === 'asc' }">▴</span
									><span :class="{ 'is-active': sort.key === column.key && sort.order === 'desc' }">▾</span></span
								>
							</button>
							<slot v-else :name="'header-' + column.key" :column="column">{{ column.label }}</slot>
						</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="(row, index) in visibleRows"
						:key="keyForRow(row, index)"
						class="ui-table__row"
						:class="{ 'ui-table__row--selected': selectedKeys.includes(keyForRow(row, index)) }"
						@click="emit('rowClick', row, index)"
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
							<slot name="empty"><UiEmptyState :description="emptyText" compact /></slot>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
		<div v-if="loading" class="ui-table__loading"><UiSpinner :size="28" /></div>
	</div>
</template>
