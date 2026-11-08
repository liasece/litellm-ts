<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import AccessActionComponent from "../../access-control/ui/AccessActionComponent.vue";
import AccessHeroIconComponent from "../../access-control/ui/AccessHeroIconComponent.vue";
import AccessNoticeComponent from "../../access-control/ui/AccessNoticeComponent.vue";
import ToolsTableComponent from "./ToolsTableComponent.vue";
import TagFieldsComponent from "./TagFieldsComponent.vue";
import TagDetailsComponent from "./TagDetailsComponent.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { createResourceStore } from "../../platform/stores/ResourceStore";
import { tagsApi, tagModels } from "../api/TagsApi";
import { dynamicSpendTagDescription, type ToolTag, type TagModelOption } from "../support/TagModels";
import "../../access-control/styles/AccessStyles.css";
import "../styles/ToolsStyles.css";
const auth = useAuthenticationStore(),
	store = createResourceStore(tagsApi.list),
	{ state, ordered } = store,
	createOpen = ref(false),
	selectedName = ref(""),
	edit = ref(false),
	deleting = ref(""),
	refreshed = ref(""),
	models = ref<TagModelOption[]>([]),
	draft = ref<Record<string, unknown>>({ tag_name: "" }),
	error = ref("");
state.sortBy = "created_at";
state.sortOrder = "desc";
const columns = [
	{ key: "name", label: "Tag Name", sortable: true },
	{ key: "description", label: "Description", sortable: true },
	{ key: "models", label: "Allowed Models", sortable: true },
	{ key: "created_at", label: "Created", sortable: true },
	{ key: "actions", label: "Actions" },
];
function tag(row: Record<string, unknown>) {
	return row as ToolTag;
}
function dynamic(row: Record<string, unknown>) {
	return row.description === dynamicSpendTagDescription;
}
/**
 * 行点击与名称按钮保持同一入口，动态 spend 标签只读不打开编辑器。
 * @param row - 表格行
 */
function openRow(row: Record<string, unknown>): void {
	if (dynamic(row)) return;
	open(tag(row));
}
function open(row: ToolTag, editing = false) {
	if (row.description === dynamicSpendTagDescription) return;
	selectedName.value = row.name;
	edit.value = editing;
}
function sort(key: string) {
	store.sort(key, state.sortBy === key && state.sortOrder === "desc" ? "asc" : "desc");
}
async function refresh() {
	await store.refresh();
	refreshed.value = new Date().toLocaleString();
}
async function create() {
	if (!draft.value.tag_name) {
		error.value = "Please input a tag name";
		return;
	}
	error.value = "";
	const value = { ...draft.value };
	draft.value = { tag_name: "" };
	if (
		await store.run(
			() =>
				tagsApi.create({
					name: value.tag_name,
					description: value.description,
					models: value.allowed_llms,
					max_budget: value.max_budget,
					soft_budget: value.soft_budget,
					tpm_limit: value.tpm_limit,
					rpm_limit: value.rpm_limit,
					budget_duration: value.budget_duration,
				}),
			"Tag created successfully",
		)
	)
		createOpen.value = false;
}
async function remove() {
	if (!deleting.value) return;
	await store.run(() => tagsApi.delete(deleting.value), "Tag deleted successfully");
	deleting.value = "";
}
function closeCreate() {
	createOpen.value = false;
	draft.value = { tag_name: "" };
	error.value = "";
}
onMounted(() => {
	void store.refresh();
	void tagModels()
		.then((value) => {
			models.value = value;
		})
		.catch((reason) => {
			state.error = reason instanceof Error ? reason.message : "Error fetching models";
		});
});
onBeforeUnmount(store.dispose);
</script>
<template>
	<main class="tools-tags-page">
		<AccessNoticeComponent :error="state.error" :message="state.message" /><TagDetailsComponent
			v-if="selectedName"
			:key="selectedName"
			:name="selectedName"
			:edit="edit"
			:admin="auth.userRole.value === 'Admin'"
			@back="
				selectedName = '';
				edit = false;
			"
			@changed="store.refresh"
		/>
		<div v-else class="tools-tags-list">
			<header>
				<h1>Tag Management</h1>
				<div>
					<span v-if="refreshed">Last Refreshed: {{ refreshed }}</span
					><button type="button" class="tools-refresh" aria-label="Refresh tags" @click="refresh">
						<AccessHeroIconComponent name="Refresh" :size="12" />
					</button>
				</div>
			</header>
			<div class="tools-tags-intro">
				Click on a tag name to view and edit its details.
				<p>
					You can use tags to restrict the usage of certain LLMs based on tags passed in the request. Read more about tag routing
					<a href="https://docs.litellm.ai/docs/proxy/tag_routing" target="_blank" rel="noopener noreferrer">here</a>.
				</p>
			</div>
			<UiButton appearance="tremor" variant="primary" @click="createOpen = true">+ Create New Tag</UiButton>
			<div class="tools-tags-table-region">
				<ToolsTableComponent
					:rows="ordered"
					:columns="columns"
					row-key="name"
					:sort-by="state.sortBy"
					:sort-order="state.sortOrder"
					empty-text="No tags found"
					@sort="sort"
					@row-click="openRow"
					><template #cell-name="{ row }"
						><UiTooltip
							:title="dynamic(row) ? 'You cannot view the information of a dynamically generated spend tag' : tag(row).name"
							><button type="button" class="tools-resource-id" :disabled="dynamic(row)" @click="open(tag(row))">
								{{ tag(row).name }}
							</button></UiTooltip
						></template
					><template #cell-description="{ value }"
						><UiTooltip :title="String(value ?? '')"
							><span>{{ value || "-" }}</span></UiTooltip
						></template
					><template #cell-models="{ row }"
						><div class="tools-model-tags">
							<UiTag v-if="!tag(row).models.length" appearance="tremor" size="xs" color="red">All Models</UiTag
							><UiTooltip v-for="model in tag(row).models" :key="model" :title="'ID: ' + model"
								><UiTag appearance="tremor" size="xs" color="blue">{{
									tag(row).model_info?.[model] || model
								}}</UiTag></UiTooltip
							>
						</div></template
					><template #cell-created_at="{ value }">{{ new Date(String(value)).toLocaleDateString() }}</template
					><template #cell-actions="{ row }"
						><div class="tools-tags">
							<AccessActionComponent
								name="SquarePen"
								:label="dynamic(row) ? 'Dynamically generated spend tags cannot be edited' : 'Edit tag'"
								:disabled="dynamic(row)"
								@click="open(tag(row), true)"
							/><AccessActionComponent
								name="Trash2"
								:label="dynamic(row) ? 'Dynamically generated spend tags cannot be deleted' : 'Delete tag'"
								:disabled="dynamic(row)"
								@click="deleting = tag(row).name"
							/></div></template
				></ToolsTableComponent>
			</div>
		</div>
		<UiDialog
			scroll-mode="overlay"
			:open="createOpen"
			title="Create New Tag"
			:width="800"
			:show-footer="false"
			@update:open="!$event && closeCreate()"
			><TagFieldsComponent
				v-model="draft"
				:models="models"
				:error="error"
				:pending="state.pending"
				creating
				@submit="create" /></UiDialog
		><UiDialog
			scroll-mode="overlay"
			:open="Boolean(deleting)"
			:width="512"
			:closable="false"
			:mask-closable="false"
			:show-footer="false"
			class="tools-tag-delete"
			@update:open="!$event && (deleting = '')"
			><div class="tools-tag-delete-body">
				<h3>Delete Tag</h3>
				<p>Are you sure you want to delete this tag?</p>
			</div>
			<footer>
				<UiButton appearance="tremor" variant="danger" :loading="state.pending" @click="remove">Delete</UiButton
				><UiButton appearance="tremor" variant="primary" @click="deleting = ''">Cancel</UiButton>
			</footer></UiDialog
		>
	</main>
</template>
