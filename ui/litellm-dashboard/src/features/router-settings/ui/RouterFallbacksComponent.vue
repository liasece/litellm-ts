<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import UiActiveFilters from "../../platform/ui/UiActiveFilters.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiHeaderFilterButton from "../../platform/ui/UiHeaderFilterButton.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import UiTableSortLabel from "../../platform/ui/UiTableSortLabel.vue";
import { filterRowsByFields } from "../../platform/ui/UiTableFilterLogic";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import DeleteResourceDialog from "../../resource-dialogs/ui/DeleteResourceDialogComponent.vue";
import FallbackAddDialog from "./FallbackAddDialogComponent.vue";
import { routerSettingsApi } from "../api/RouterSettingsApi";
import { routerRecord, routerString, routerSettingsOnly, fallbackEntries, type FallbackEntry } from "../support/RouterSettingsModels";
import { getModelLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
import notification from "../../notifications/logic/NotificationManager";
const values = ref<Record<string, unknown>>({}),
	costs = ref<Record<string, unknown>>({}),
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
function changeSort(order: "asc" | "desc" | false): void {
	sort.value = { key: "primary", order: order || null };
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
	const results = await Promise.allSettled([routerSettingsApi.load(), routerSettingsApi.costs()]);
	if (results[0].status === "fulfilled") values.value = routerSettingsOnly(results[0].value);
	if (results[1].status === "fulfilled") costs.value = results[1].value;
});
function logo(name: string) {
	return getModelLogoAndName(routerString(routerRecord(costs.value[name]).litellm_provider), name).logo;
}
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
		<div v-if="!rows.length" class="routing-no-fallbacks">
			No fallbacks configured. Add fallbacks to automatically try another model when the primary fails.
		</div>
		<template v-else>
			<UiActiveFilters
				v-if="activeFilters.length"
				:filters="activeFilters"
				@remove="removeFallbackFilter"
				@clear="clearFallbackFilters"
			/>
			<div class="routing-table-scroll">
				<table class="routing-table">
					<thead>
						<tr>
							<th>
								<div class="routing-table-heading">
									<UiTableSortLabel
										label="Model Name"
										:state="sort.key === 'primary' ? (sort.order ?? false) : false"
										@change="changeSort"
									/>
									<UiHeaderFilterButton
										label="Model Name"
										:fields="primaryFilter"
										:active="activeFilters.filter((filter) => filter.key === 'primary')"
										@change="applyFallbackFilters"
									/>
								</div>
							</th>
							<th>
								<div class="routing-table-heading">
									<span>Fallbacks</span>
									<UiHeaderFilterButton
										label="Fallbacks"
										:fields="fallbackFilter"
										:active="activeFilters.filter((filter) => filter.key === 'fallbacks')"
										@change="applyFallbackFilters"
									/>
								</div>
							</th>
							<th>Actions</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="(row, index) in sortedRows" :key="index + row.primary">
							<td>
								<span class="routing-model-card"
									><img v-if="logo(row.primary)" :src="logo(row.primary)!" :alt="row.primary + ' logo'" /><span>{{
										row.primary
									}}</span></span
								>
							</td>
							<td>
								<div class="routing-fallback-row">
									<UiHeroIcon name="ArrowRightIcon" :size="20" />
									<div>
										<template v-for="(name, position) in row.models" :key="name"
											><UiHeroIcon v-if="position" name="ArrowRightIcon" :size="16" /><span class="routing-model-card"
												><img v-if="logo(name)" :src="logo(name)!" :alt="name + ' logo'" /><span>{{
													name
												}}</span></span
											></template
										>
									</div>
								</div>
							</td>
							<td>
								<div class="routing-fallback-table-actions">
									<UiTooltip title="Test fallback"
										><button type="button" aria-label="Test fallback" @click="test(row.primary)">
											<UiHeroIcon name="PlayIcon" :size="20" /></button></UiTooltip
									><UiTooltip title="Delete fallback"
										><button
											type="button"
											aria-label="Delete fallback"
											data-testid="delete-fallback-button"
											@click="
												selected = row.entry;
												deleteOpen = true;
											"
										>
											<UiHeroIcon name="TrashIcon" :size="20" /></button
									></UiTooltip>
								</div>
							</td>
						</tr>
						<tr v-if="!sortedRows.length">
							<td colspan="3" class="routing-no-fallbacks">{{ emptyText }}</td>
						</tr>
					</tbody>
				</table>
			</div>
		</template>
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
