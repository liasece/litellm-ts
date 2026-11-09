<script setup lang="ts">
import { computed, ref } from "vue";
import UiTable from "../../../platform/ui/UiTable.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import type { UiTableActiveFilter, UiTableFilterField } from "../../../platform/ui/UiTableFilterModels";
import type { UiTableColumn, UiTableRow, UiTableSort } from "../../../platform/ui/UiTypes";
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
	sort = ref<{ key: string; order: "asc" | "desc" | null }>({ key: "deleted_at", order: "desc" });
const tableColumns = computed<readonly UiTableColumn[]>(() =>
	props.columns.map((column) => ({
		key: column.key,
		label: column.label,
		width: column.width,
		maxWidth: column.maxWidth,
		sortable: true,
		initialSortOrder: initialSort(column),
		filters: props.filterFields[column.key],
	})),
);
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
function initialSort(column: DeletedLogColumn): "asc" | "desc" {
	return column.kind === "date" || column.kind === "money" || column.kind === "key-budget" || column.kind === "team-budget"
		? "desc"
		: "asc";
}
function changeSort(next: UiTableSort): void {
	sort.value = { key: next.key, order: next.order };
}
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
function rowKey(row: UiTableRow): string {
	return String(row.token || row.team_id || "");
}
</script>
<template>
	<div class="deleted-records-scroll">
		<UiTable
			:columns="tableColumns"
			:rows="sorted"
			:row-key="rowKey"
			:loading="loading"
			:loading-text="'🚅 Loading ' + kind + '...'"
			fixed-layout
			resizable
			manual-sort
			sticky-header
			:sort-by="sort.order ? sort.key : undefined"
			:sort-order="sort.order ?? 'desc'"
			:active-filters="activeFilters"
			:empty-text="emptyText"
			@sort="changeSort"
			@filter-change="emit('filterChange', $event)"
			@remove-filter="emit('removeFilter', $event)"
			@clear-filters="emit('clearFilters')"
		>
			<template #row="{ row }">
				<tr class="ui-table__row">
					<td
						v-for="column in columns"
						:key="column.key"
						:style="{ width: column.width + 'px', maxWidth: column.maxWidth + 'px' }"
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
			</template>
		</UiTable>
	</div>
</template>
<style>
.deleted-records-scroll {
	height: 75vh;
	overflow: auto;
}
.deleted-model-label {
	display: block;
	color: #6b7280;
	font-size: 12.4px;
	line-height: 18.4px;
	font-weight: 400;
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
.deleted-models {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	max-width: 300px;
}
</style>
