<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import AccessActionComponent from "../../access-control/ui/AccessActionComponent.vue";
import AccessDeleteDialogComponent from "../../access-control/ui/AccessDeleteDialogComponent.vue";
import AccessNoticeComponent from "../../access-control/ui/AccessNoticeComponent.vue";
import { objectValue } from "../../access-control/logic/ResourceDraftLogic";
import SearchToolFormDialogComponent from "./SearchToolFormDialogComponent.vue";
import SearchToolDetailsComponent from "./SearchToolDetailsComponent.vue";
import { createResourceStore } from "../../platform/stores/ResourceStore";
import { filterRowsByFields } from "../../platform/ui/UiTableFilterLogic";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { isAdminRole } from "../../identity/logic/UserRoleLogic";
import { searchToolsApi } from "../api/SearchToolsApi";
import type { SearchTool, SearchProvider } from "../support/SearchToolModels";
import "../../access-control/styles/AccessStyles.css";
import "../styles/ToolsStyles.css";
import "../styles/SearchToolsStyles.css";
const auth = useAuthenticationStore(),
	admin = computed(() => isAdminRole(auth.userRole.value)),
	store = createResourceStore(searchToolsApi.list),
	{ state, rows } = store,
	providers = ref<SearchProvider[]>([]),
	selected = ref<SearchTool | null>(null),
	editing = ref<SearchTool | null>(null),
	formOpen = ref(false),
	deleting = ref<SearchTool | null>(null);
const activeFilters = ref<UiTableActiveFilter[]>([]);
const toolIdFilter: readonly UiTableFilterField[] = [
	{ key: "search_tool_id", label: "Search Tool ID", control: { kind: "text", placeholder: "Filter search tool ID" } },
];
const toolNameFilter: readonly UiTableFilterField[] = [
	{ key: "search_tool_name", label: "Name", control: { kind: "text", placeholder: "Filter search tool name" } },
];
const providerFilter = computed<readonly UiTableFilterField[]>(() => [
	{
		key: "provider",
		label: "Provider",
		control: {
			kind: "select",
			searchable: true,
			options: providers.value.map((provider) => ({
				value: provider.provider_name,
				label: provider.ui_friendly_name || provider.provider_name,
			})),
		},
	},
]);
const columns = computed(() => [
	{ key: "search_tool_id", label: "Search Tool ID", width: 180, sortable: true, filters: toolIdFilter },
	{ key: "search_tool_name", label: "Name", width: 200, sortable: true, filters: toolNameFilter },
	{ key: "provider", label: "Provider", width: 160, sortable: true, filters: providerFilter.value },
	{ key: "created_at", label: "Created At", width: 140, sortable: true, initialSortOrder: "desc" as const },
	{ key: "updated_at", label: "Updated At", width: 140, sortable: true, initialSortOrder: "desc" as const },
	{ key: "source", label: "Source", width: 130 },
	{ key: "actions", label: "Actions", width: 120, sticky: "right" as const },
]);
const filteredRows = computed(() =>
	filterRowsByFields(rows.value, activeFilters.value, (row, key) =>
		key === "provider" ? objectValue(row.litellm_params).search_provider : row[key],
	),
);
const emptyText = computed(() => (activeFilters.value.length ? "No records match the current filters" : "No search tools configured"));
function applyToolFilters(entries: readonly UiTableActiveFilter[]): void {
	const next = activeFilters.value.filter((filter) => !entries.some((entry) => entry.key === filter.key));
	for (const entry of entries) {
		if (entry.value.trim()) next.push({ ...entry, value: entry.value.trim(), text: entry.text || entry.value.trim() });
	}
	activeFilters.value = next;
}
function removeToolFilter(key: string): void {
	activeFilters.value = activeFilters.value.filter((filter) => filter.key !== key);
}
function clearToolFilters(): void {
	activeFilters.value = [];
}
function tool(row: Record<string, unknown>) {
	return row as SearchTool;
}
function edit(item: SearchTool) {
	selected.value = item;
	editing.value = item;
	formOpen.value = true;
}
function formChanged() {
	if (editing.value) selected.value = null;
	void store.refresh();
}
function formClosed() {
	if (editing.value) selected.value = null;
	editing.value = null;
}
const deleteInfo = computed(() =>
	deleting.value
		? [
				{ label: "Name", value: deleting.value.search_tool_name },
				{ label: "ID", value: deleting.value.search_tool_id, code: true },
				{
					label: "Provider",
					value:
						providers.value.find((p) => p.provider_name === deleting.value?.litellm_params.search_provider)?.ui_friendly_name ||
						deleting.value.litellm_params.search_provider,
				},
				{ label: "Description", value: deleting.value.search_tool_info?.description || "-" },
			]
		: [],
);
async function remove() {
	const id = deleting.value?.search_tool_id;
	if (!id) return;
	if (await store.run(() => searchToolsApi.delete(id), "Deleted search tool successfully")) deleting.value = null;
}
onMounted(() => {
	void store.refresh();
	void searchToolsApi
		.providers()
		.then((value) => {
			providers.value = value;
		})
		.catch((error) => {
			state.error = error instanceof Error ? error.message : "Failed to fetch search providers";
		});
});
onBeforeUnmount(store.dispose);
</script>
<template>
	<main class="tools-search-page">
		<AccessNoticeComponent :error="state.error" :message="state.message" />
		<h1>Search Tools</h1>
		<p class="tools-search-subtitle">Configure and manage your search providers</p>
		<UiButton
			v-if="admin"
			class="tools-search-add"
			appearance="tremor"
			variant="primary"
			@click="
				editing = null;
				formOpen = true;
			"
			>+ Add New Search Tool</UiButton
		><SearchToolDetailsComponent
			v-if="selected"
			:tool="selected"
			:providers="providers"
			@back="
				selected = null;
				store.refresh();
			"
			@error="state.error = $event"
			@notice="state.message = $event"
		/><UiTable
			v-else
			class="tools-search-table"
			:columns="columns"
			:rows="filteredRows"
			row-key="search_tool_id"
			fixed-layout
			:loading="state.loading"
			row-clickable
			:active-filters="activeFilters"
			@row-click="selected = tool($event)"
			@filter-change="applyToolFilters"
			@remove-filter="removeToolFilter"
			@clear-filters="clearToolFilters"
			><template #cell-search_tool_id="{ row }"
				><span v-if="tool(row).is_from_config">-</span
				><button v-else class="tools-resource-id" @click="selected = tool(row)">{{ tool(row).search_tool_id }}</button></template
			><template #cell-search_tool_name="{ value }"
				><span style="font-weight: 500">{{ value }}</span></template
			><template #cell-provider="{ row }">{{
				providers.find((p) => p.provider_name === tool(row).litellm_params.search_provider)?.ui_friendly_name ||
				tool(row).litellm_params.search_provider
			}}</template
			><template v-for="key in ['created_at', 'updated_at']" :key="key" #[`cell-${key}`]="{ value }"
				><span class="tools-search-date">{{ value ? new Date(String(value)).toLocaleDateString() : "-" }}</span></template
			><template #cell-source="{ row }"
				><UiTag :color="tool(row).is_from_config ? 'default' : 'blue'">{{
					tool(row).is_from_config ? "Config" : "DB"
				}}</UiTag></template
			><template #cell-actions="{ row }"
				><div class="tools-tags">
					<AccessActionComponent
						name="SquarePen"
						:label="
							tool(row).is_from_config
								? 'Config search tool cannot be edited on the dashboard. Please edit it from the config file.'
								: 'Edit search tool'
						"
						:disabled="tool(row).is_from_config"
						@click="edit(tool(row))"
					/><AccessActionComponent
						name="Trash2"
						:label="
							tool(row).is_from_config
								? 'Config search tool cannot be deleted on the dashboard. Please delete it from the config file.'
								: 'Delete search tool'
						"
						:disabled="tool(row).is_from_config"
						@click="deleting = tool(row)"
					/></div></template
			><template #empty>{{ emptyText }}</template></UiTable
		><SearchToolFormDialogComponent
			v-model:open="formOpen"
			:tool="editing"
			:providers="providers"
			@saved="formChanged"
			@notice="state.message = $event"
			@error="state.error = $event"
			@update:open="!$event && formClosed()"
		/><AccessDeleteDialogComponent
			:open="Boolean(deleting)"
			title="Delete Search Tool"
			message="Are you sure you want to delete this search tool? This action cannot be undone."
			information-title="Search Tool Information"
			:information="deleteInfo"
			:pending="state.pending"
			@update:open="!$event && (deleting = null)"
			@confirm="remove"
		/>
	</main>
</template>
