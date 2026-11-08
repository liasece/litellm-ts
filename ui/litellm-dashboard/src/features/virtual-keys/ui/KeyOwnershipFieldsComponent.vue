<script setup lang="ts">
import { useKeyFieldIdentity } from "../support/KeyFormIdentity";
import { computed, onBeforeUnmount, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import { searchKeyOwners } from "../data/KeyCatalogData";
import { selectedString, type KeyCatalog, type KeyDraft } from "../support/VirtualKeyModels";
import type { UiSelectOption } from "../../platform/ui/UiTypes";
import KeyField from "./KeyFieldComponent.vue";
const draft = defineModel<KeyDraft>({ required: true });
const props = defineProps<{
	catalog: KeyCatalog;
	role: string;
	errors: Record<string, string>;
	lockTeam?: boolean;
	lockProject?: boolean;
}>();
const emit = defineEmits<{ createUser: [] }>();
const userOptions = ref<UiSelectOption[]>([]);
const searching = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
let request: AbortController | null = null;
let generation = 0;
const teams = computed(() =>
	props.catalog.teams
		.filter((team) => !draft.value.organization_id || team.organization_id === draft.value.organization_id)
		.map((team) => ({ value: team.team_id, label: team.team_alias || team.team_id })),
);
const projects = computed(() =>
	props.catalog.projects
		.filter((project) => !draft.value.team_id || !project.team_id || project.team_id === draft.value.team_id)
		.map((project) => ({ value: project.project_id, label: project.project_alias || project.project_id })),
);
function changeOrganization(value: unknown) {
	draft.value.organization_id = selectedString(value);
	draft.value.team_id = "";
	draft.value.project_id = "";
}
function changeTeam(value: unknown) {
	draft.value.team_id = selectedString(value);
	draft.value.project_id = "";
	draft.value.organization_id = props.catalog.teams.find((team) => team.team_id === draft.value.team_id)?.organization_id || "";
}
function changeProject(value: unknown) {
	draft.value.project_id = selectedString(value);
	const project = props.catalog.projects.find((project) => project.project_id === draft.value.project_id);
	draft.value.team_id = project?.team_id || "";
	if (project?.team_id)
		draft.value.organization_id = props.catalog.teams.find((team) => team.team_id === project.team_id)?.organization_id || "";
}
function searchUsers(value: string) {
	if (timer) clearTimeout(timer);
	request?.abort();
	const current = ++generation;
	if (!value) {
		userOptions.value = [];
		return;
	}
	timer = setTimeout(async () => {
		request = new AbortController();
		searching.value = true;
		try {
			const options = await searchKeyOwners(value, request.signal);
			if (generation === current) userOptions.value = options;
		} catch {
			if (generation === current) userOptions.value = [];
		} finally {
			if (generation === current) searching.value = false;
		}
	}, 300);
}
onBeforeUnmount(() => {
	generation++;
	request?.abort();
	if (timer) clearTimeout(timer);
});
const fieldId = useKeyFieldIdentity();
</script>
<template>
	<section class="vk-form-section">
		<h2 class="vk-form-title">Key Ownership</h2>
		<KeyField class="vk-ownership-choice" label="Owned By" tooltip="Select who will own this Virtual Key" horizontal
			><div class="vk-owner-radios">
				<label
					v-for="owner in [
						{ value: 'you', label: 'You' },
						{ value: 'service_account', label: 'Service Account' },
						...(role === 'Admin' ? [{ value: 'another_user', label: 'Another User' }] : []),
						{ value: 'agent', label: 'Agent' },
					]"
					:key="owner.value"
					><input v-model="draft.owner" type="radio" name="key-owner" :value="owner.value" /><span class="vk-owner-radio-text"
						>{{ owner.label }}{{ owner.value === "agent" ? " " : ""
						}}<UiTag v-if="owner.value === 'agent'" color="purple">New</UiTag></span
					></label
				>
			</div></KeyField
		>
		<KeyField
			v-if="draft.owner === 'another_user'"
			label="User ID"
			name="user_id"
			:error="errors.user_id"
			tooltip="The user who will own this key and be responsible for its usage"
			horizontal
			><div class="vk-owner-search">
				<UiSelect
					:id="fieldId('user_id')"
					:model-value="draft.user_id || null"
					:options="userOptions"
					:filterable="false"
					searchable
					clearable
					:loading="searching"
					placeholder="Type email to search for users"
					@search="searchUsers"
					@update:model-value="draft.user_id = selectedString($event)"
				/><UiButton @click="emit('createUser')">Create User</UiButton>
			</div>
			<small class="vk-help">Search by email to find users</small></KeyField
		>
		<div v-if="draft.owner === 'agent'" class="vk-agent-owner">
			<label>Select Agent <span>*</span></label
			><UiSelect
				:model-value="draft.agent_id || null"
				:options="catalog.agents"
				searchable
				placeholder="Select an agent"
				@update:model-value="draft.agent_id = selectedString($event)"
			/><small>This key will be used by the selected agent to make requests to LiteLLM</small>
			<p v-if="errors.agent_id" class="vk-field-error">{{ errors.agent_id }}</p>
		</div>
		<KeyField
			label="Organization"
			name="organization_id"
			tooltip="The organization this key belongs to. Selecting an organization filters the available teams."
			horizontal
			><UiSelect
				:id="fieldId('organization_id')"
				:model-value="draft.organization_id || null"
				:options="
					catalog.organizations.map((org) => ({
						value: org.organization_id,
						label: org.organization_alias || org.organization_id,
					}))
				"
				:disabled="role !== 'Admin'"
				clearable
				placeholder="All Organizations"
				@update:model-value="changeOrganization"
		/></KeyField>
		<KeyField
			label="Team"
			name="team_id"
			tooltip="The team this key belongs to, which determines available models and budget limits"
			:help="draft.owner === 'service_account' ? 'required' : undefined"
			:error="errors.team_id"
			:required="draft.owner === 'service_account'"
			horizontal
			><UiSelect
				:id="fieldId('team_id')"
				:model-value="draft.team_id || null"
				:options="teams"
				:disabled="lockTeam || Boolean(draft.project_id)"
				searchable
				clearable
				placeholder="Search or select a team"
				@update:model-value="changeTeam"
		/></KeyField>
		<div v-if="draft.owner === 'service_account' || errors.team_id" class="vk-create-field-margin-offset" aria-hidden="true" />
		<KeyField
			v-if="catalog.uiSettings.enable_projects_ui"
			label="Project"
			name="project_id"
			tooltip="Assign this key to a project. Selecting a project will lock the team to the project's team."
			horizontal
			><UiSelect
				:id="fieldId('project_id')"
				:model-value="draft.project_id || null"
				:options="projects"
				:disabled="lockProject"
				searchable
				clearable
				placeholder="Search or select a project"
				@update:model-value="changeProject"
		/></KeyField>
	</section>
</template>
