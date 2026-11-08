<script setup lang="ts">
import UiIcon from "../../platform/ui/UiIcon.vue";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiPagination from "../../platform/ui/UiPagination.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import AccessActionComponent from "./AccessActionComponent.vue";
import AccessDeleteDialogComponent from "./AccessDeleteDialogComponent.vue";
import AccessNoticeComponent from "./AccessNoticeComponent.vue";
import GroupFormDialogComponent from "./GroupFormDialogComponent.vue";
import GroupDetailsComponent from "./GroupDetailsComponent.vue";
import { accessApi } from "../api/AccessApi";
import { loadAccessCatalog } from "../data/AccessCatalogData";
import { emptyAccessCatalog, type AccessGroup, type GroupDraft } from "../support/AccessModels";
import { createResourceStore } from "../stores/ResourceStore";
import "../styles/AccessStyles.css";
const store = createResourceStore(accessApi.groups, accessApi.group, (group, query) =>
		[group.access_group_name, group.access_group_id, group.description ?? ""].some((value) =>
			value.toLocaleLowerCase().includes(query),
		),
	),
	{ state, selected, filtered, ordered } = store;
const catalog = shallowRef(emptyAccessCatalog()),
	formOpen = ref(false),
	editing = ref<AccessGroup | null>(null),
	deleting = ref<AccessGroup | null>(null),
	detailId = ref("");
const columns = computed(() => [
	{ key: "access_group_id", label: "ID", width: 170 },
	{ key: "access_group_name", label: "Name", sortable: true },
	{ key: "resources", label: "Resources" },
	...(window.innerWidth >= 992 ? [{ key: "created_at", label: "Created", sortable: true }] : []),
	...(window.innerWidth >= 1200 ? [{ key: "updated_at", label: "Updated" }] : []),
	{ key: "actions", label: "Actions" },
]);
const rows = computed(() => ordered.value.slice((state.page - 1) * state.pageSize, state.page * state.pageSize));
watch(
	() => state.query,
	() => {
		state.page = 1;
	},
);
function group(row: Record<string, unknown>) {
	return row as AccessGroup;
}
function create() {
	editing.value = null;
	formOpen.value = true;
}
function edit() {
	editing.value = selected.value;
	formOpen.value = true;
}
async function open(value: AccessGroup) {
	detailId.value = value.access_group_id;
	await store.open(detailId.value, value);
}
function back() {
	detailId.value = "";
	store.close();
}
async function submit(value: GroupDraft) {
	const payload = {
		access_group_name: value.name,
		description: value.description,
		access_model_names: value.modelIds,
		access_mcp_server_ids: value.mcpServerIds,
		access_agent_ids: value.agentIds,
	};
	const item = editing.value;
	if (
		await store.run(
			() => (item ? accessApi.updateGroup(item.access_group_id, payload) : accessApi.createGroup(payload)),
			item ? "Access group updated successfully" : "Access group created successfully",
			async () => {
				if (item) await store.open(item.access_group_id);
			},
		)
	)
		formOpen.value = false;
}
async function remove() {
	const item = deleting.value;
	if (item && (await store.run(() => accessApi.deleteGroup(item.access_group_id), "Access group deleted successfully")))
		deleting.value = null;
}
onMounted(() => {
	void store.refresh();
	void loadAccessCatalog()
		.then((value) => {
			catalog.value = value;
		})
		.catch((error) => {
			state.error = error instanceof Error ? error.message : "Failed to load resource options";
		});
});
onBeforeUnmount(store.dispose);
</script>
<template>
	<main class="access-page access-groups-page">
		<AccessNoticeComponent :error="state.error" :message="state.message" /><GroupDetailsComponent
			v-if="detailId && selected"
			:group="selected"
			@back="back"
			@edit="edit"
		/>
		<p v-else-if="detailId">{{ state.detailLoading ? "Loading..." : "Access group not found" }}</p>
		<template v-else
			><header class="access-list-header">
				<div>
					<h2>Access Groups</h2>
					<span class="access-muted">Manage resource permissions for your organization</span>
				</div>
				<UiButton variant="primary" @click="create"
					><template #icon><UiIcon name="PlusOutlined" /></template>Create Access Group</UiButton
				>
			</header>
			<UiCard appearance="antd" :padding="0" class="access-list-card"
				><div class="access-list-toolbar">
					<UiInput
						v-model="state.query"
						placeholder="Search groups by name, ID, or description..."
						clearable
						class="access-search"
						><template #prefix><UiLucideIcon name="Search" :size="16" /></template
					></UiInput>
					<div class="access-pagination">
						<span>{{ filtered.length }} groups</span
						><UiPagination v-model="state.page" :total="filtered.length" :page-size="10" />
					</div>
				</div>
				<UiTable
					:columns="columns"
					:rows="rows"
					row-key="access_group_id"
					:loading="state.loading"
					manual-sort
					@sort="store.sort($event.key, $event.order)"
					><template #cell-access_group_id="{ row }"
						><button type="button" class="access-id" :title="group(row).access_group_id" @click="open(group(row))">
							{{ group(row).access_group_id }}
						</button></template
					><template #cell-resources="{ row }"
						><div class="access-tags access-resource-tags">
							<UiTag color="blue" :title="group(row).access_model_names.length + ' Models'"
								><UiLucideIcon name="LayersIcon" :size="14" />{{ group(row).access_model_names.length }}</UiTag
							><UiTag color="cyan" :title="group(row).access_mcp_server_ids.length + ' MCP Servers'"
								><UiLucideIcon name="ServerIcon" :size="14" />{{ group(row).access_mcp_server_ids.length }}</UiTag
							><UiTag color="purple" :title="group(row).access_agent_ids.length + ' Agents'"
								><UiLucideIcon name="Bot" :size="14" />{{ group(row).access_agent_ids.length }}</UiTag
							>
						</div></template
					><template #cell-created_at="{ value }">{{ new Date(String(value)).toLocaleDateString() }}</template
					><template #cell-updated_at="{ value }">{{ new Date(String(value)).toLocaleDateString() }}</template
					><template #cell-actions="{ row }"
						><AccessActionComponent
							name="Trash2"
							label="Delete access group"
							danger
							@click="deleting = group(row)" /></template></UiTable></UiCard></template
		><GroupFormDialogComponent
			v-model:open="formOpen"
			:group="editing"
			:catalog="catalog"
			:pending="state.pending"
			@submit="submit"
		/><AccessDeleteDialogComponent
			:open="Boolean(deleting)"
			title="Delete Access Group"
			message="Are you sure you want to delete this access group? This action cannot be undone."
			information-title="Access Group Information"
			:information="[
				{ label: 'ID', value: deleting?.access_group_id, code: true },
				{ label: 'Name', value: deleting?.access_group_name },
				{ label: 'Description', value: deleting?.description || '—' },
			]"
			:pending="state.pending"
			@update:open="!$event && (deleting = null)"
			@confirm="remove"
		/>
	</main>
</template>
