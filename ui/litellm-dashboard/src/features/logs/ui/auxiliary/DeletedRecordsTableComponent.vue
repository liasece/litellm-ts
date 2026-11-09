<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from "vue";
import UiActiveFilters from "../../../platform/ui/UiActiveFilters.vue";
import UiHeaderFilterButton from "../../../platform/ui/UiHeaderFilterButton.vue";
import UiTableSortLabel from "../../../platform/ui/UiTableSortLabel.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import type { UiTableActiveFilter, UiTableFilterField } from "../../../platform/ui/UiTableFilterModels";
import { useMoneyFormatter } from "../../../platform/stores/PriceDisplayStore";
import type { DeletedLogColumn } from "../../support/DeletedLogColumnModels";
const props = withDefaults(
	defineProps<{
		rows: readonly Record<string, unknown>[];
		columns: readonly DeletedLogColumn[];
		loading: boolean;
		kind: "keys" | "teams";
		filterFields?: Partial<Record<string, readonly UiTableFilterField[]>>;
		activeFilters?: readonly UiTableActiveFilter[];
	}>(),
	{ filterFields: () => ({}), activeFilters: () => [] },
);
const emit = defineEmits<{
	filterChange: [entries: readonly UiTableActiveFilter[]];
	removeFilter: [key: string];
	clearFilters: [];
}>();
const money = useMoneyFormatter(),
	sort = ref<{ key: string; order: "asc" | "desc" | null }>({ key: "deleted_at", order: "desc" }),
	widths = reactive<Record<string, number>>({});
const tableWidth = computed(() => props.columns.reduce((sum, c) => sum + (widths[c.key] ?? c.width), 0));
const sorted = computed(() => {
	if (!sort.value.order) return props.rows;
	const { key, order } = sort.value,
		direction = order === "asc" ? 1 : -1;
	return props.rows
		.map((row, index) => ({ row, index }))
		.sort((a, b) => {
			const x = a.row[key],
				y = b.row[key];
			let diff = 0;
			if (x === undefined || y === undefined) {
				if (x === undefined && y !== undefined) diff = 1;
				else if (y === undefined && x !== undefined) diff = -1;
			} else if (typeof x === "number" && typeof y === "number") diff = x > y ? 1 : x < y ? -1 : 0;
			else {
				const left = String(x ?? "").toLowerCase(),
					right = String(y ?? "").toLowerCase();
				diff = left > right ? 1 : left < right ? -1 : 0;
			}
			return diff * direction || a.index - b.index;
		})
		.map((item) => item.row);
});
const emptyText = computed(() =>
	props.activeFilters.length ? "No deleted " + props.kind + " match the current filters" : "No deleted " + props.kind + " found",
);
function sortDirection(column: DeletedLogColumn): "asc" | "desc" | false {
	return sort.value.key === column.key ? (sort.value.order ?? false) : false;
}
function initialSort(column: DeletedLogColumn): "asc" | "desc" {
	return column.kind === "date" || column.kind === "money" || column.kind === "key-budget" || column.kind === "team-budget"
		? "desc"
		: "asc";
}
function changeSort(column: DeletedLogColumn, order: "asc" | "desc" | false): void {
	sort.value = { key: column.key, order: order || null };
}
let cleanup: (() => void) | undefined;
function resize(event: PointerEvent, column: DeletedLogColumn) {
	event.preventDefault();
	event.stopPropagation();
	cleanup?.();
	const x = event.clientX,
		start = widths[column.key] ?? column.width;
	const move = (e: PointerEvent) => {
		widths[column.key] = Math.max(20, Math.min(column.maxWidth, start + e.clientX - x));
	};
	const end = () => {
		document.removeEventListener("pointermove", move);
		document.removeEventListener("pointerup", end);
		cleanup = undefined;
	};
	document.addEventListener("pointermove", move);
	document.addEventListener("pointerup", end);
	cleanup = end;
}
onBeforeUnmount(() => cleanup?.());
function display(row: Record<string, unknown>, column: DeletedLogColumn): string {
	const value = row[column.key];
	if (column.kind === "date") return value ? new Date(String(value)).toLocaleDateString() : "-";
	if (column.kind === "money") return money(typeof value === "number" ? value : undefined, 4);
	if (column.kind === "key-budget") return value === null ? "Unlimited" : money(typeof value === "number" ? value : undefined, 4);
	if (column.kind === "team-budget") return value == null ? "No limit" : money(Number(value), 4);
	return column.key === "key_alias" || column.key === "user_email" ? String(value ?? "-") : String(value || "-");
}
function models(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function modelName(value: string) {
	return value.replace(/^openai\//, "");
}
</script>
<template>
	<div v-if="activeFilters.length" class="deleted-records-filters">
		<UiActiveFilters :filters="activeFilters" @remove="emit('removeFilter', $event)" @clear="emit('clearFilters')" />
	</div>
	<div class="deleted-records-scroll">
		<div class="deleted-records-border">
			<div class="deleted-records-x">
				<table class="deleted-records-table" :style="{ width: tableWidth + 'px' }">
					<thead>
						<tr>
							<th
								v-for="column in columns"
								:key="column.key"
								:style="{ width: (widths[column.key] ?? column.width) + 'px', maxWidth: column.maxWidth + 'px' }"
							>
								<div class="deleted-records-header">
									<UiTableSortLabel
										:label="column.label"
										:state="sortDirection(column)"
										:initial="initialSort(column)"
										@change="changeSort(column, $event)"
									/>
									<UiHeaderFilterButton
										v-if="filterFields[column.key]?.length"
										:label="column.label"
										:fields="filterFields[column.key] ?? []"
										:active="
											activeFilters.filter((filter) =>
												filterFields[column.key]?.some((field) => field.key === filter.key),
											)
										"
										@change="emit('filterChange', $event)"
									/>
								</div>
								<span
									class="deleted-records-resizer"
									@click.stop
									@dblclick.stop="delete widths[column.key]"
									@pointerdown="resize($event, column)"
								/>
							</th>
						</tr>
					</thead>
					<tbody>
						<tr v-if="loading">
							<td :colspan="columns.length" class="deleted-records-empty">🚅 Loading {{ kind }}...</td>
						</tr>
						<tr v-for="(row, index) in loading ? [] : sorted" :key="String(row.token || row.team_id || index)">
							<td
								v-for="column in columns"
								:key="column.key"
								:style="{ width: (widths[column.key] ?? column.width) + 'px', maxWidth: column.maxWidth + 'px' }"
							>
								<div v-if="column.kind === 'models'" class="deleted-models">
									<UiTag v-if="!models(row.models).length" appearance="tremor" size="xs" color="red"
										><span class="deleted-model-label">All Proxy Models</span></UiTag
									><UiTag
										v-for="(model, i) in models(row.models).slice(0, 3)"
										:key="i"
										appearance="tremor"
										size="xs"
										:color="model === 'all-proxy-models' ? 'red' : 'blue'"
										><span class="deleted-model-label">{{
											model === "all-proxy-models"
												? "All Proxy Models"
												: model.length > 30
													? modelName(model).slice(0, 30) + "..."
													: modelName(model)
										}}</span></UiTag
									><UiTag v-if="models(row.models).length > 3" appearance="tremor" size="xs" color="gray"
										><span class="deleted-model-label"
											>+{{ models(row.models).length - 3 }} more model{{
												models(row.models).length - 3 === 1 ? "" : "s"
											}}</span
										></UiTag
									>
								</div>
								<UiTooltip v-else :content="display(row, column)"
									><span
										class="deleted-records-value"
										:class="{
											'logs-mono': column.mono,
											'deleted-records-blue': column.blue,
											'deleted-records-mono': column.mono,
										}"
										:style="{ maxWidth: column.maxWidth + 'px' }"
										>{{ display(row, column) }}</span
									></UiTooltip
								>
							</td>
						</tr>
						<tr v-if="!loading && !sorted.length">
							<td :colspan="columns.length" class="deleted-records-empty">{{ emptyText }}</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	</div>
</template>
<style>
.deleted-records-filters .ui-active-filters {
	padding-top: 0;
	padding-bottom: 10px;
}
.deleted-records-scroll {
	height: 75vh;
	overflow: auto;
}
.deleted-records-border {
	position: relative;
	border: 1px solid #dcddeb;
	border-radius: 8px;
}
.deleted-records-x {
	overflow-x: auto;
}
.deleted-records-table {
	border-collapse: collapse;
	font: 12.4px/18.4px var(--ui-font-sans);
	color: #6b7280;
	text-align: left;
}
.deleted-records-table th {
	position: relative;
	padding: 4px 16px;
	height: 32px;
	white-space: nowrap;
	font-weight: 600;
	color: #111827;
}
.deleted-records-table th:hover {
	background: #f9fafb;
}
.deleted-records-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 6px;
}
.deleted-records-table tbody tr:first-child td {
	border-top: 0;
}
.deleted-model-label {
	display: block;
	color: #6b7280;
	font-size: 12.4px;
	line-height: 18.4px;
	font-weight: 400;
}
.deleted-records-table td {
	padding: 2px 16px;
	height: 32px;
	white-space: pre-wrap;
	overflow: hidden;
	border-top: 1px solid #e5e7eb;
}
.deleted-records-value {
	display: block;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}
.deleted-records-blue {
	color: #3b82f6;
}
.deleted-records-mono {
	font-size: 12px;
	line-height: 16px;
}
.deleted-records-empty {
	text-align: center;
	color: #6b7280;
}
.deleted-records-resizer {
	position: absolute;
	right: 0;
	top: 0;
	height: 100%;
	width: 5px;
	background: transparent;
	cursor: col-resize;
	user-select: none;
	touch-action: none;
	opacity: 0;
}
.deleted-records-table th:hover .deleted-records-resizer {
	opacity: 0.5;
}
.deleted-records-resizer:hover {
	background: #3b82f6;
}
.deleted-models {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	max-width: 300px;
}
</style>
