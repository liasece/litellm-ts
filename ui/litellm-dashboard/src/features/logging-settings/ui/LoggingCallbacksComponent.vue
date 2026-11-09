<script setup lang="ts">
import { computed, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { filterRowsByFields } from "../../platform/ui/UiTableFilterLogic";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import type { UiTableColumn, UiTableRow, UiTableSort } from "../../platform/ui/UiTypes";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import CallbackDialog from "./CallbackDialogComponent.vue";
import { loggingSettingsApi, type LoggingCallback, type AvailableCallbacks } from "../api/LoggingSettingsApi";
import notification from "../../notifications/logic/NotificationManager";
const props = defineProps<{ callbacks: LoggingCallback[]; available: AvailableCallbacks }>();
const emit = defineEmits<{ changed: [] }>();
const editOpen = ref(false),
	addOpen = ref(false),
	selected = ref<LoggingCallback | null>(null);
function display(callback: LoggingCallback) {
	const raw = props.available[callback.name];
	return raw && typeof raw === "object" && "ui_callback_name" in raw ? String(raw.ui_callback_name) : callback.name;
}
function modeLabel(callback: LoggingCallback) {
	return (
		({ success: "Success", failure: "Failure", success_and_failure: "Success & Failure" } as Record<string, string>)[
			callback.mode || "success"
		] || callback.mode
	);
}
const activeFilters = ref<UiTableActiveFilter[]>([]);
const sort = ref<{ key: string; order: "asc" | "desc" | null }>({ key: "", order: null });
const nameFilter: readonly UiTableFilterField[] = [
	{ key: "name", label: "Callback Name", control: { kind: "text", placeholder: "Filter callback name" } },
];
const modeFilter: readonly UiTableFilterField[] = [
	{
		key: "mode",
		label: "Mode",
		control: {
			kind: "select",
			options: [
				{ value: "success", label: "Success" },
				{ value: "failure", label: "Failure" },
				{ value: "success_and_failure", label: "Success & Failure" },
			],
		},
	},
];
const filteredCallbacks = computed(() =>
	filterRowsByFields(props.callbacks, activeFilters.value, (callback, key) =>
		key === "name" ? display(callback) : callback.mode || "success",
	),
);
const sortedCallbacks = computed(() => {
	if (!sort.value.order) return filteredCallbacks.value;
	const direction = sort.value.order === "asc" ? 1 : -1;
	return [...filteredCallbacks.value].sort((a, b) => display(a).localeCompare(display(b)) * direction);
});
const emptyText = computed(() => (activeFilters.value.length ? "No callbacks match the current filters" : "No callbacks configured"));
const columns: readonly UiTableColumn[] = [
	{ key: "name", label: "Callback Name", width: 320, sortable: true, filters: nameFilter },
	{ key: "mode", label: "Mode", width: 200, filters: modeFilter },
	{ key: "actions", label: "Actions", width: 120, sticky: "right" },
];
function callbackRow(row: UiTableRow): LoggingCallback {
	return row as unknown as LoggingCallback;
}
function changeSort(next: UiTableSort): void {
	sort.value = { key: "name", order: next.order };
}
function applyCallbackFilters(entries: readonly UiTableActiveFilter[]): void {
	const next = activeFilters.value.filter((filter) => !entries.some((entry) => entry.key === filter.key));
	for (const entry of entries) {
		if (entry.value.trim()) next.push({ ...entry, value: entry.value.trim(), text: entry.text || entry.value.trim() });
	}
	activeFilters.value = next;
}
function removeCallbackFilter(key: string): void {
	activeFilters.value = activeFilters.value.filter((filter) => filter.key !== key);
}
function clearCallbackFilters(): void {
	activeFilters.value = [];
}
async function test(callback: LoggingCallback) {
	try {
		await loggingSettingsApi.test(callback.name);
		notification.success("Health check triggered");
	} catch (error) {
		notification.fromBackend(error);
	}
}
</script>
<template>
	<div class="logging-callbacks">
		<UiButton v-if="Object.keys(available).length" appearance="tremor" variant="primary" @click="addOpen = true"
			>+ Add Callback</UiButton
		>
		<div class="logging-callbacks-heading"><h4>Active Logging Callbacks</h4></div>
		<UiTable
			:columns="columns"
			:rows="sortedCallbacks"
			row-key="name"
			fixed-layout
			manual-sort
			:sort-by="sort.order ? 'name' : undefined"
			:sort-order="sort.order ?? 'asc'"
			:active-filters="activeFilters"
			:empty-text="emptyText"
			@sort="changeSort"
			@filter-change="applyCallbackFilters"
			@remove-filter="removeCallbackFilter"
			@clear-filters="clearCallbackFilters"
		>
			<template #row="{ row }">
				<tr v-for="callback in [callbackRow(row)]" :key="callback.name" class="ui-table__row">
					<td>{{ display(callback) }}</td>
					<td>
						<span
							class="logging-callback-mode"
							:class="
								callback.mode === 'failure'
									? 'logging-callback-mode--failure'
									: !callback.mode || callback.mode === 'success'
										? 'logging-callback-mode--success'
										: 'logging-callback-mode--other'
							"
							>{{ modeLabel(callback) }}</span
						>
					</td>
					<td class="ui-table__cell--sticky-right">
						<div class="logging-callback-actions">
							<UiTooltip title="Test Callback"
								><button type="button" aria-label="Test Callback" @click="test(callback)">
									<UiHeroIcon name="PlayIcon" /></button></UiTooltip
							><UiTooltip title="Edit Callback"
								><button
									type="button"
									aria-label="Edit Callback"
									@click="
										selected = callback;
										editOpen = true;
									"
								>
									<UiHeroIcon name="PencilAltIcon" /></button
							></UiTooltip>
						</div>
					</td>
				</tr>
			</template>
		</UiTable>
		<CallbackDialog v-model:open="addOpen" :available="available" @changed="emit('changed')" /><CallbackDialog
			v-model:open="editOpen"
			:callback="selected"
			:available="available"
			@changed="emit('changed')"
		/>
	</div>
</template>
