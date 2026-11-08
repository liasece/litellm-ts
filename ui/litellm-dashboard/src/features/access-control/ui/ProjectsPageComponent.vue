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
import AccessNoticeComponent from "./AccessNoticeComponent.vue";
import ProjectFormDialogComponent from "./ProjectFormDialogComponent.vue";
import ProjectDetailsComponent from "./ProjectDetailsComponent.vue";
import { accessApi } from "../api/AccessApi";
import { loadAccessCatalog } from "../data/AccessCatalogData";
import { emptyAccessCatalog, type AccessProject, type ProjectDraft } from "../support/AccessModels";
import { buildProjectPayload } from "../logic/ProjectDraftLogic";
import { createResourceStore } from "../stores/ResourceStore";
import "../styles/AccessStyles.css";
const catalog = shallowRef(emptyAccessCatalog());
const store = createResourceStore(accessApi.projects, accessApi.project, (project, query) =>
		[
			project.project_alias ?? "",
			project.project_id,
			project.description ?? "",
			catalog.value.teams.find((team) => team.team_id === project.team_id)?.team_alias ?? "",
		].some((value) => value.toLocaleLowerCase().includes(query)),
	),
	{ state, selected, filtered, ordered } = store;
const formOpen = ref(false),
	editing = ref<AccessProject | null>(null),
	detailId = ref("");
const columns = computed(() => [
	{ key: "project_id", label: "ID", width: 170 },
	{ key: "project_alias", label: "Name", sortable: true },
	{ key: "team_id", label: "Team", sortable: true },
	{ key: "models", label: "Models" },
	{ key: "blocked", label: "Status" },
	...(window.innerWidth >= 992 ? [{ key: "created_at", label: "Created", sortable: true }] : []),
	...(window.innerWidth >= 1200 ? [{ key: "updated_at", label: "Updated" }] : []),
]);
const rows = computed(() => ordered.value.slice((state.page - 1) * 10, state.page * 10));
watch(
	() => state.query,
	() => {
		state.page = 1;
	},
);
function project(row: Record<string, unknown>) {
	return row as AccessProject;
}
function create() {
	editing.value = null;
	formOpen.value = true;
}
function edit() {
	editing.value = selected.value;
	formOpen.value = true;
}
async function open(value: AccessProject) {
	detailId.value = value.project_id;
	await store.open(detailId.value, value);
}
function back() {
	detailId.value = "";
	store.close();
}
async function submit(value: ProjectDraft) {
	const item = editing.value;
	if (
		await store.run(
			() =>
				item
					? accessApi.updateProject(item.project_id, buildProjectPayload(value))
					: accessApi.createProject(buildProjectPayload(value)),
			item ? "Project updated successfully" : "Project created successfully",
		)
	) {
		formOpen.value = false;
		if (item) back();
	}
}
onMounted(() => {
	void store.refresh();
	void loadAccessCatalog()
		.then((value) => {
			catalog.value = value;
		})
		.catch((error) => {
			state.error = error instanceof Error ? error.message : "Failed to load project options";
		});
});
onBeforeUnmount(store.dispose);
</script>
<template>
	<main class="access-page">
		<AccessNoticeComponent :error="state.error" :message="state.message" />
		<header class="access-list-header">
			<div>
				<h2>Projects</h2>
				<span class="access-muted">Manage projects within your teams</span>
			</div>
			<UiButton variant="primary" @click="create"
				><template #icon><UiIcon name="PlusOutlined" /></template>Create Project</UiButton
			>
		</header>
		<UiCard appearance="antd" :padding="0" class="access-list-card"
			><div class="access-list-toolbar">
				<UiInput
					v-model="state.query"
					placeholder="Search projects by name, ID, description, or team..."
					clearable
					class="access-search"
					><template #prefix><UiLucideIcon name="Search" :size="16" /></template
				></UiInput>
				<div class="access-pagination">
					<span>{{ filtered.length }} projects</span
					><UiPagination v-model="state.page" :total="filtered.length" :page-size="10" />
				</div>
			</div>
			<UiTable
				:columns="columns"
				:rows="rows"
				row-key="project_id"
				:loading="state.loading"
				manual-sort
				@sort="store.sort($event.key, $event.order)"
				><template #cell-project_id="{ row }"
					><button type="button" class="access-id" :title="project(row).project_id" @click="open(project(row))">
						{{ project(row).project_id }}
					</button></template
				><template #cell-project_alias="{ row }">{{ project(row).project_alias || "—" }}</template
				><template #cell-team_id="{ row }">{{
					catalog.teams.find((team) => team.team_id === project(row).team_id)?.team_alias || project(row).team_id || "—"
				}}</template
				><template #cell-models="{ row }"
					><div class="access-resource-tags">
						<UiTag color="blue" :title="project(row).models.length ? project(row).models.join(', ') : 'No models'"
							><UiLucideIcon name="LayersIcon" :size="14" />{{ project(row).models.length }}</UiTag
						>
					</div></template
				><template #cell-blocked="{ value }"
					><UiTag :color="value ? 'red' : 'green'">{{ value ? "Blocked" : "Active" }}</UiTag></template
				><template #cell-created_at="{ value }">{{ new Date(String(value)).toLocaleDateString() }}</template
				><template #cell-updated_at="{ value }">{{ new Date(String(value)).toLocaleDateString() }}</template></UiTable
			></UiCard
		><ProjectFormDialogComponent
			v-model:open="formOpen"
			:project="editing"
			:catalog="catalog"
			:pending="state.pending"
			@submit="submit"
		/><ProjectDetailsComponent
			:open="Boolean(detailId)"
			:project="selected"
			:loading="state.detailLoading"
			@update:open="!$event && back()"
			@edit="edit"
		/>
	</main>
</template>
