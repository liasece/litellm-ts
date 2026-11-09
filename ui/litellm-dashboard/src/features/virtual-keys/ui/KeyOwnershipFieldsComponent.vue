<script setup lang="ts">
import { useKeyFieldIdentity } from "../support/KeyFormIdentity";
import { computed, onBeforeUnmount, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
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
function changeOrganization(value: unknown) {
	draft.value.organization_id = selectedString(value);
	draft.value.team_id = "";
}
function changeTeam(value: unknown) {
	draft.value.team_id = selectedString(value);
	draft.value.organization_id = props.catalog.teams.find((team) => team.team_id === draft.value.team_id)?.organization_id || "";
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
						...(role === 'Admin' ? [{ value: 'another_user', label: 'Another User' }] : []),
					]"
					:key="owner.value"
					><input v-model="draft.owner" type="radio" name="key-owner" :value="owner.value" /><span class="vk-owner-radio-text">{{
						owner.label
					}}</span></label
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
			:error="errors.team_id"
			horizontal
			><UiSelect
				:id="fieldId('team_id')"
				:model-value="draft.team_id || null"
				:options="teams"
				:disabled="lockTeam"
				searchable
				clearable
				placeholder="Search or select a team"
				@update:model-value="changeTeam"
		/></KeyField>
		<div v-if="errors.team_id" class="vk-create-field-margin-offset" aria-hidden="true" />
	</section>
</template>
