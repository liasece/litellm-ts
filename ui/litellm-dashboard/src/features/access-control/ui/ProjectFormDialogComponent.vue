<script setup lang="ts">
import UiFormField from "../../platform/ui/UiFormField.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { computed, reactive, ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import AccessFieldComponent from "./AccessFieldComponent.vue";
import AccessActionComponent from "./AccessActionComponent.vue";
import { createProjectDraft, validateProjectDraft } from "../logic/ProjectDraftLogic";
import type { AccessCatalog, AccessProject, ProjectDraft } from "../support/AccessModels";
import { loadAccessCatalog } from "../data/AccessCatalogData";
const props = defineProps<{ open: boolean; project?: AccessProject | null; catalog: AccessCatalog; pending?: boolean }>();
const emit = defineEmits<{ "update:open": [open: boolean]; submit: [draft: ProjectDraft] }>();
const draft = reactive(createProjectDraft()),
	errors = ref<Record<string, string>>({}),
	advanced = ref(false),
	teamModels = ref<string[]>([]);
const models = computed(() => [
	{ value: "all-team-models", label: "All Team Models" },
	...teamModels.value.map((value) => ({ value, label: value })),
]);
watch(
	() => props.open,
	(open) => {
		if (open) {
			Object.assign(draft, createProjectDraft(props.project ?? undefined));
			errors.value = {};
			advanced.value = false;
			void teamChanged(false);
		}
	},
);
async function teamChanged(reset = true) {
	if (reset) draft.models = [];
	const team = props.catalog.teams.find((item) => item.team_id === draft.team_id);
	teamModels.value = [...(team?.models ?? [])];
	if (team) {
		try {
			const scoped = await loadAccessCatalog(team.team_id);
			if (draft.team_id === team.team_id)
				teamModels.value = [...new Set([...team.models, ...scoped.models.map((model) => model.value)])];
		} catch {
			/* The team models remain available when optional catalog loading fails. */
		}
	}
}
function modelChanged(value: unknown) {
	if (Array.isArray(value) && value.includes("all-team-models")) draft.models = ["all-team-models"];
}
function submit() {
	errors.value = validateProjectDraft(draft);
	if (Object.keys(errors.value).length) {
		if (errors.value.metadata || errors.value.modelLimits) advanced.value = true;
		return;
	}
	emit("submit", { ...draft });
}
</script>
<template>
	<UiDialog
		class="access-project-dialog"
		scroll-mode="overlay"
		:open="open"
		:title="project ? 'Edit Project' : 'Create New Project'"
		:width="720"
		:show-footer="false"
		@update:open="emit('update:open', $event)"
		><form class="access-project-form" @submit.prevent="submit">
			<span class="access-form-section-label">Basic Information</span>
			<hr class="access-project-divider" />
			<div class="access-columns">
				<AccessFieldComponent
					v-model="draft.project_alias"
					name="project-name"
					label="Project Name"
					required
					placeholder="e.g. Customer Support Bot"
					:error="errors.project_alias"
				/><AccessFieldComponent
					v-model="draft.team_id"
					name="project-team"
					label="Team"
					type="select"
					required
					:options="
						catalog.teams.map((team) => ({
							value: team.team_id,
							label: (team.team_alias || team.team_id) + ' (' + team.team_id + ')',
						}))
					"
					placeholder="Search or select a team"
					:error="errors.team_id"
					@change="teamChanged()"
				/>
			</div>
			<AccessFieldComponent
				v-model="draft.description"
				name="project-description"
				label="Description"
				type="textarea"
				:rows="3"
				placeholder="Describe the purpose of this project"
			/><AccessFieldComponent
				v-model="draft.models"
				name="project-models"
				max-tag-count="responsive"
				label="Allowed Models (scoped to selected team's models)"
				type="select"
				multiple
				:options="models"
				:disabled="!draft.team_id"
				:placeholder="draft.team_id ? 'Select models' : 'Select a team first'"
				:help="draft.team_id ? undefined : 'Select a team first to see available models'"
				@change="modelChanged"
			/>
			<div class="access-columns">
				<UiFormField label="Max Budget (USD)" for="project-budget"
					><div class="access-project-budget">
						<span aria-hidden="true">$</span
						><UiInputNumber id="project-budget" v-model="draft.max_budget" :min="0" :precision="2" placeholder="0.00" /></div
				></UiFormField>
			</div>
			<details class="access-advanced" :open="advanced">
				<summary><UiIcon name="RightOutlined" :size="12" />Advanced Settings</summary>
				<div class="access-advanced-body">
					<AccessFieldComponent
						v-model="draft.isBlocked"
						class="access-project-block-field"
						name="project-blocked"
						label="Block Project"
						type="switch"
					/><UiAlert
						v-if="draft.isBlocked"
						type="warning"
						title="All API requests using keys under this project will be rejected."
					/>
					<hr />
					<strong>Model-Specific Limits</strong>
					<div v-for="(limit, index) in draft.modelLimits" :key="index" class="access-form-repeat-row">
						<AccessFieldComponent
							v-model="limit.model"
							:name="'project-limit-model-' + index"
							placeholder="Model name (e.g. gpt-4)"
							:error="errors.modelLimits"
						/><AccessFieldComponent
							v-model="limit.tpm"
							:name="'project-limit-tpm-' + index"
							type="number"
							:min="0"
							placeholder="TPM Limit"
						/><AccessFieldComponent
							v-model="limit.rpm"
							:name="'project-limit-rpm-' + index"
							type="number"
							:min="0"
							placeholder="RPM Limit"
						/><AccessActionComponent
							name="CircleMinus"
							label="Remove model limit"
							danger
							@click="draft.modelLimits.splice(index, 1)"
						/>
					</div>
					<UiButton block class="access-dashed" @click="draft.modelLimits.push({ model: '', rpm: null, tpm: null })"
						>＋ Add Model Limit</UiButton
					>
					<hr />
					<strong>Metadata</strong>
					<div v-for="(item, index) in draft.metadata" :key="index" class="access-form-repeat-row">
						<AccessFieldComponent
							v-model="item.key"
							:name="'project-metadata-key-' + index"
							placeholder="Key"
							:error="errors.metadata"
						/><AccessFieldComponent
							v-model="item.value"
							:name="'project-metadata-value-' + index"
							placeholder="Value"
						/><AccessActionComponent
							name="CircleMinus"
							label="Remove metadata"
							danger
							@click="draft.metadata.splice(index, 1)"
						/>
					</div>
					<UiButton block class="access-dashed" @click="draft.metadata.push({ key: '', value: '' })"
						>＋ Add Key-Value Pair</UiButton
					>
				</div>
			</details>
			<footer class="access-form-footer">
				<UiButton @click="emit('update:open', false)">Cancel</UiButton
				><UiButton variant="primary" type="submit" :loading="pending"
					><template #icon><UiIcon :name="project ? 'SaveOutlined' : 'FolderAddOutlined'" /></template
					>{{ project ? "Save Changes" : "Create Project" }}</UiButton
				>
			</footer>
		</form></UiDialog
	>
</template>
