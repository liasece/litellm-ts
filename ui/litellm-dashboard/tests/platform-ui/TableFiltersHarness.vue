<script setup lang="ts">
import { computed, ref } from "vue";
import UiTable from "../../src/features/platform/ui/UiTable.vue";
import { filterRowsByFields } from "../../src/features/platform/ui/UiTableFilterLogic";
import type { UiTableActiveFilter, UiTableFilterField } from "../../src/features/platform/ui/UiTableFilterModels";

const nameFilter: readonly UiTableFilterField[] = [{ key: "name", label: "Model", control: { kind: "text", placeholder: "Filter model" } }];
const providerFilter: readonly UiTableFilterField[] = [
	{
		key: "provider",
		label: "Provider",
		control: {
			kind: "select",
			options: [
				{ value: "openai", label: "OpenAI" },
				{ value: "anthropic", label: "Anthropic" },
			],
		},
	},
];
const columns = [
	{ key: "name", label: "Model", sortable: true, filters: nameFilter },
	{ key: "provider", label: "Provider", sortable: true, filters: providerFilter },
];
const rows = [
	{ id: "1", name: "zeta", provider: "openai" },
	{ id: "2", name: "alpha", provider: "anthropic" },
	{ id: "3", name: "beta", provider: "openai" },
];
const activeFilters = ref<UiTableActiveFilter[]>([]);
const filteredRows = computed(() => filterRowsByFields(rows, activeFilters.value, (row, key) => row[key as "name" | "provider"]));
function apply(entries: readonly UiTableActiveFilter[]): void {
	const next = activeFilters.value.filter((filter) => !entries.some((entry) => entry.key === filter.key));
	for (const entry of entries) {
		if (entry.value.trim()) next.push({ ...entry, value: entry.value.trim(), text: entry.text || entry.value.trim() });
	}
	activeFilters.value = next;
}
function remove(key: string): void {
	activeFilters.value = activeFilters.value.filter((filter) => filter.key !== key);
}
</script>

<template>
	<main style="padding: 24px; max-width: 900px">
		<UiTable
			:columns="columns"
			:rows="filteredRows"
			:active-filters="activeFilters"
			@filter-change="apply"
			@remove-filter="remove"
			@clear-filters="activeFilters = []"
		/>
	</main>
</template>
