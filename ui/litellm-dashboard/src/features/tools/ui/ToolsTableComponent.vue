<script setup lang="ts">
import AccessHeroIconComponent from "../../access-control/ui/AccessHeroIconComponent.vue";
import { isTableRowInteractiveTarget } from "../../platform/logic/TableRowClick";
import type { UiTableColumn } from "../../platform/ui/UiTypes";
withDefaults(
	defineProps<{
		rows: Record<string, unknown>[];
		columns: UiTableColumn[];
		rowKey?: string;
		sortBy?: string;
		sortOrder?: "asc" | "desc";
		loading?: boolean;
		emptyText?: string;
		stickyActions?: boolean;
	}>(),
	{ rowKey: "id", sortBy: "", sortOrder: "desc", emptyText: "No data", stickyActions: true },
);
const emit = defineEmits<{ sort: [key: string]; rowClick: [row: Record<string, unknown>] }>();
function clickRow(event: MouseEvent, row: Record<string, unknown>): void {
	if (isTableRowInteractiveTarget(event)) return;
	emit("rowClick", row);
}
</script>
<template>
	<div class="tools-table-wrap">
		<div class="tools-table-scroll">
			<table class="tools-table">
				<thead>
					<tr>
						<th
							v-for="column in columns"
							:key="column.key"
							:class="{ 'tools-table-actions': stickyActions && column.key === 'actions' }"
							:style="{
								width: typeof column.width === 'number' ? column.width + 'px' : column.width,
								textAlign: column.align,
							}"
						>
							<button v-if="column.sortable" type="button" @click="emit('sort', column.key)">
								<slot :name="'header-' + column.key" :column="column">{{ column.label }}</slot
								><AccessHeroIconComponent
									:name="sortBy === column.key ? (sortOrder === 'asc' ? 'ChevronUp' : 'ChevronDown') : 'SwitchVertical'"
									:class="sortBy === column.key ? 'tools-sort-active' : 'tools-sort-inactive'"
								/></button
							><slot v-else :name="'header-' + column.key" :column="column">{{ column.label }}</slot>
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-if="loading">
						<td :colspan="columns.length" class="tools-table-empty">Loading...</td>
					</tr>
					<tr v-for="(row, index) in loading ? [] : rows" :key="String(row[rowKey] ?? index)" @click="clickRow($event, row)">
						<td
							v-for="column in columns"
							:key="column.key"
							:class="{ 'tools-table-actions': stickyActions && column.key === 'actions' }"
						>
							<slot :name="'cell-' + column.key" :row="row" :value="row[column.key]" :index="index">{{
								row[column.key] ?? "-"
							}}</slot>
						</td>
					</tr>
					<tr v-if="!loading && !rows.length">
						<td :colspan="columns.length" class="tools-table-empty">{{ emptyText }}</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>
</template>
