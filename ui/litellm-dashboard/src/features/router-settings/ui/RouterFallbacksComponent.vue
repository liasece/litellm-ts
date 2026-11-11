<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import { filterRowsByFields } from "../../platform/ui/UiTableFilterLogic";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import type { UiTableColumn, UiTableRow, UiTableSort } from "../../platform/ui/UiTypes";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import DeleteResourceDialog from "../../resource-dialogs/ui/DeleteResourceDialogComponent.vue";
import FallbackAddDialog from "./FallbackAddDialogComponent.vue";
import { routerSettingsApi } from "../api/RouterSettingsApi";
import { routerString, routerSettingsOnly, fallbackEntries, type FallbackEntry } from "../support/RouterSettingsModels";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { fetchModelGroupIcons, type ModelGroupIcons } from "../../providers/api/ModelGroupIconsApi";
import notification from "../../notifications/logic/NotificationManager";
const values = ref<Record<string, unknown>>({}),
	modelIcons = ref<ModelGroupIcons>(new Map()),
	addOpen = ref(false),
	deleteOpen = ref(false),
	deleting = ref(false),
	saving = ref(false),
	selected = ref<FallbackEntry | null>(null);
const rows = computed(() =>
	fallbackEntries(values.value.fallbacks).flatMap((entry) =>
		Object.entries(entry).map(([primary, models]) => ({ entry, primary, models })),
	),
);
const activeFilters = ref<UiTableActiveFilter[]>([]);
const sort = ref<{ key: string; order: "asc" | "desc" | null }>({ key: "", order: null });
const primaryFilter: readonly UiTableFilterField[] = [
	{ key: "primary", label: "Model Name", control: { kind: "text", placeholder: "Filter primary model" } },
];
const fallbackFilter: readonly UiTableFilterField[] = [
	{ key: "fallbacks", label: "Fallbacks", control: { kind: "text", placeholder: "Filter fallback models" } },
];
const filteredRows = computed(() =>
	filterRowsByFields(rows.value, activeFilters.value, (row, key) => (key === "fallbacks" ? row.models.join(" ") : row.primary)),
);
const sortedRows = computed(() => {
	if (!sort.value.order) return filteredRows.value;
	const direction = sort.value.order === "asc" ? 1 : -1;
	return [...filteredRows.value].sort((a, b) => a.primary.localeCompare(b.primary) * direction);
});
const emptyText = computed(() =>
	activeFilters.value.length
		? "No fallbacks match the current filters."
		: "No fallbacks configured. Add fallbacks to automatically try another model when the primary fails.",
);
const columns: readonly UiTableColumn[] = [
	{ key: "primary", label: "Model Name", width: 240, sortable: true, filters: primaryFilter },
	{ key: "fallbacks", label: "Fallbacks", width: 560, filters: fallbackFilter },
	{ key: "actions", label: "Actions", width: 120, sticky: "right" },
];
interface FallbackRow {
	entry: FallbackEntry;
	primary: string;
	models: string[];
}
function fallbackRow(row: UiTableRow): FallbackRow {
	return row as unknown as FallbackRow;
}
function changeSort(next: UiTableSort): void {
	sort.value = { key: "primary", order: next.order };
}
function applyFallbackFilters(entries: readonly UiTableActiveFilter[]): void {
	const next = activeFilters.value.filter((filter) => !entries.some((entry) => entry.key === filter.key));
	for (const entry of entries) {
		if (entry.value.trim()) next.push({ ...entry, value: entry.value.trim(), text: entry.text || entry.value.trim() });
	}
	activeFilters.value = next;
}
function removeFallbackFilter(key: string): void {
	activeFilters.value = activeFilters.value.filter((filter) => filter.key !== key);
}
function clearFallbackFilters(): void {
	activeFilters.value = [];
}
onMounted(async () => {
	const results = await Promise.allSettled([routerSettingsApi.load(), fetchModelGroupIcons()]);
	if (results[0].status === "fulfilled") values.value = routerSettingsOnly(results[0].value);
	if (results[1].status === "fulfilled") modelIcons.value = results[1].value;
});
async function save(groups: FallbackEntry[]) {
	saving.value = true;
	try {
		const next = { ...values.value, fallbacks: [...fallbackEntries(values.value.fallbacks), ...groups] };
		await routerSettingsApi.update({ router_settings: next });
		values.value = next;
		notification.success(groups.length + " fallback configuration(s) added successfully!");
		addOpen.value = false;
	} catch (error) {
		notification.fromBackend("Failed to update router settings: " + String(error));
		values.value = routerSettingsOnly(await routerSettingsApi.load());
	} finally {
		saving.value = false;
	}
}
async function remove() {
	if (!selected.value) return;
	const name = Object.keys(selected.value)[0];
	if (!name) return;
	deleting.value = true;
	const fallbacks = fallbackEntries(values.value.fallbacks)
		.map((entry) => {
			const next = { ...entry };
			if (Array.isArray(next[name])) delete next[name];
			return next;
		})
		.filter((entry) => Object.keys(entry).length);
	try {
		const next = { ...values.value, fallbacks };
		await routerSettingsApi.update({ router_settings: next });
		values.value = next;
		notification.success("Router settings updated successfully");
	} catch (error) {
		notification.fromBackend("Failed to update router settings: " + String(error));
	} finally {
		deleting.value = false;
		deleteOpen.value = false;
		selected.value = null;
	}
}
async function test(name: string) {
	notification.info("Testing fallback model response...");
	try {
		const result = await routerSettingsApi.testFallback(name);
		notification.success("Test model=" + name + ", received model=" + routerString(result.model) + ". See curl");
	} catch (error) {
		notification.fromBackend("Error occurred while generating model response. Please try again. Error: " + String(error));
	}
}
</script>
<template>
	<div class="routing-fallbacks">
		<UiButton appearance="tremor" variant="primary" @click="addOpen = true"
			><template #icon><span class="routing-fallback-plus">+</span></template
			>Add Fallbacks</UiButton
		>
		<UiTable
			:columns="columns"
			:rows="sortedRows"
			row-key="primary"
			fixed-layout
			manual-sort
			:sort-by="sort.order ? 'primary' : undefined"
			:sort-order="sort.order ?? 'asc'"
			:active-filters="activeFilters"
			:empty-text="emptyText"
			@sort="changeSort"
			@filter-change="applyFallbackFilters"
			@remove-filter="removeFallbackFilter"
			@clear-filters="clearFallbackFilters"
		>
			<template #row="{ row }">
				<tr v-for="item in [fallbackRow(row)]" :key="item.primary" class="ui-table__row">
					<td>
						<ModelName class="routing-model-card" :model="item.primary" v-bind="modelIcons.get(item.primary)" />
					</td>
					<td>
						<div class="routing-fallback-row">
							<UiHeroIcon name="ArrowRightIcon" :size="20" />
							<div>
								<template v-for="(name, position) in item.models" :key="name"
									><UiHeroIcon v-if="position" name="ArrowRightIcon" :size="16" /><ModelName
										class="routing-model-card"
										:model="name"
										v-bind="modelIcons.get(name)"
								/></template>
							</div>
						</div>
					</td>
					<td class="ui-table__cell--sticky-right">
						<div class="routing-fallback-table-actions">
							<UiTooltip title="Test fallback"
								><button type="button" aria-label="Test fallback" @click="test(item.primary)">
									<UiHeroIcon name="PlayIcon" :size="20" /></button></UiTooltip
							><UiTooltip title="Delete fallback"
								><button
									type="button"
									aria-label="Delete fallback"
									data-testid="delete-fallback-button"
									@click="
										selected = item.entry;
										deleteOpen = true;
									"
								>
									<UiHeroIcon name="TrashIcon" :size="20" /></button
							></UiTooltip>
						</div>
					</td>
				</tr>
			</template>
		</UiTable>
		<FallbackAddDialog v-model:open="addOpen" :pending="saving" @save="save" />
		<DeleteResourceDialog
			v-model:open="deleteOpen"
			title="Delete Fallback?"
			message="Are you sure you want to delete this fallback? This action cannot be undone."
			information-title="Fallback Information"
			:information="[{ label: 'Model Name', value: selected ? Object.keys(selected)[0] : '', code: true }]"
			:pending="deleting"
			@confirm="remove"
		/>
	</div>
</template>
