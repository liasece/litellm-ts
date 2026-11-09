<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import AccessFieldComponent from "./AccessFieldComponent.vue";
import TeamGeneralFieldsComponent from "./TeamGeneralFieldsComponent.vue";
import TeamAdvancedFieldsComponent from "./TeamAdvancedFieldsComponent.vue";
import RouterSettingsFormComponent from "./RouterSettingsFormComponent.vue";
import ModelAliasesComponent from "./ModelAliasesComponent.vue";
import KeyLoggingFieldsComponent from "../../virtual-keys/ui/KeyLoggingFieldsComponent.vue";
import type { KeyLoggingConfiguration } from "../../virtual-keys/support/VirtualKeyModels";
import { adminOrganizations } from "../logic/AccessPermissionLogic";
import { objectValue, parseMetadata, stringList, teamDraft } from "../logic/ResourceDraftLogic";
import type { AccessCatalog, AccessRecord } from "../support/AccessModels";
const props = defineProps<{
	open: boolean;
	catalog: AccessCatalog;
	role: string;
	userId: string;
	premium?: boolean;
	pending?: boolean;
	organizationId?: string;
}>();
const emit = defineEmits<{ "update:open": [open: boolean]; submit: [draft: AccessRecord] }>();
const draft = ref<AccessRecord>(teamDraft()),
	errors = ref<Record<string, string>>({}),
	routerOpen = ref(false),
	loggingOpen = ref(false);
const organizations = computed(() => adminOrganizations(props.role, props.userId, props.catalog.organizations));
watch(
	() => props.open,
	(open) => {
		if (open) {
			draft.value = teamDraft();
			draft.value.organization_id =
				organizations.value.length === 1 ? organizations.value[0].organization_id : props.organizationId || null;
			errors.value = {};
			routerOpen.value = false;
			loggingOpen.value = false;
		}
	},
);
const aliases = computed({
		get: () => objectValue(draft.value.model_aliases) as Record<string, string>,
		set: (value) => {
			draft.value.model_aliases = value;
		},
	}),
	router = computed({
		get: () => objectValue(draft.value.router_settings),
		set: (value) => {
			draft.value.router_settings = value;
		},
	}),
	logging = computed({
		get: () => ({
			logging: (Array.isArray(draft.value.logging_settings) ? draft.value.logging_settings : []) as KeyLoggingConfiguration[],
			disabled_callbacks: [] as string[],
		}),
		set: (value) => {
			draft.value.logging_settings = value.logging;
		},
	});
function submit() {
	errors.value = {};
	if (!draft.value.team_alias) errors.value.team_alias = "Please input a team name";
	if (!stringList(draft.value.models).length) errors.value.models = "Please select at least one model";
	if (props.role !== "Admin" && !draft.value.organization_id) errors.value.organization_id = "Please select an organization";
	for (const field of ["metadata", "secret_manager_settings"]) {
		try {
			parseMetadata(draft.value[field], field);
		} catch {
			errors.value[field] = "Please enter valid JSON";
		}
	}
	if (!Object.keys(errors.value).length) emit("submit", { ...draft.value });
}
</script>
<template>
	<UiDialog
		class="access-create-horizontal access-team-create-dialog"
		scroll-mode="overlay"
		:open="open"
		title="Create Team"
		:width="1000"
		:show-footer="false"
		@update:open="emit('update:open', $event)"
		><form class="access-team-create-form" @submit.prevent="submit">
			<AccessFieldComponent
				v-model="draft.team_alias"
				name="create-team-name"
				label="Team Name"
				required
				horizontal
				:error="errors.team_alias"
			/><AccessFieldComponent
				v-model="draft.organization_id"
				name="create-team-organization"
				label="Organization"
				type="select"
				:options="
					organizations.map((org) => ({
						value: org.organization_id,
						label: org.organization_alias + ' (' + org.organization_id + ')',
					}))
				"
				:disabled="organizations.length === 1"
				:required="role !== 'Admin'"
				:placeholder="organizations.length ? 'Search or select an Organization' : 'No organizations available'"
				:help="
					organizations.length === 1
						? 'You can only create teams within this organization'
						: role !== 'Admin'
							? 'required'
							: undefined
				"
				:error="errors.organization_id"
				horizontal
				><template #label
					>Organization
					<UiTooltip
						><UiIcon name="InfoCircleOutlined" :size="14" class="access-field-tooltip" /><template #content
							>Organizations can have multiple teams. Learn more about
							<a
								href="https://docs.litellm.ai/docs/proxy/user_management_heirarchy"
								target="_blank"
								rel="noopener noreferrer"
								@click.stop
								>user management hierarchy</a
							></template
						></UiTooltip
					></template
				></AccessFieldComponent
			><UiAlert
				v-if="role !== 'Admin' && organizations.length > 1"
				class="access-team-org-alert"
				type="info"
				:show-icon="false"
				title="Please select an organization to create a team for. You can only create teams within organizations where you are an admin."
			/><TeamGeneralFieldsComponent v-model="draft" :catalog="catalog" :errors="errors" hide-name />
			<details class="access-tremor-accordion access-team-additional">
				<summary>
					<b>Additional Settings</b
					><svg
						class="access-team-accordion-arrow"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							d="M11.9999 13.1714L16.9497 8.22168L18.3639 9.63589L11.9999 15.9999L5.63599 9.63589L7.0502 8.22168L11.9999 13.1714Z"
						/>
					</svg>
				</summary>
				<div>
					<TeamAdvancedFieldsComponent v-model="draft" :premium="premium" :errors="errors" />
				</div>
			</details>
			<details class="access-tremor-accordion">
				<summary>
					<b>Resource Permissions</b
					><svg
						class="access-team-accordion-arrow"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							d="M11.9999 13.1714L16.9497 8.22168L18.3639 9.63589L11.9999 15.9999L5.63599 9.63589L7.0502 8.22168L11.9999 13.1714Z"
						/>
					</svg>
				</summary>
			</details>
			<details class="access-tremor-accordion" :open="loggingOpen">
				<summary @click.prevent="loggingOpen = !loggingOpen">
					<b>Logging Settings</b
					><svg
						class="access-team-accordion-arrow"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							d="M11.9999 13.1714L16.9497 8.22168L18.3639 9.63589L11.9999 15.9999L5.63599 9.63589L7.0502 8.22168L11.9999 13.1714Z"
						/>
					</svg>
				</summary>
				<div v-if="loggingOpen">
					<KeyLoggingFieldsComponent v-if="premium" v-model="logging" />
					<div v-else>
						<div class="access-premium-logging-tags">✨ langfuse-logging ✨ datadog-logging</div>
						<UiAlert type="warning"
							><p>
								Setting Key/Team logging settings is a LiteLLM Enterprise feature. Global Logging Settings are available for
								all free users. Get a trial key
								<a href="https://www.litellm.ai/#pricing" target="_blank" rel="noopener noreferrer">here</a>.
							</p></UiAlert
						>
					</div>
				</div>
			</details>
			<details class="access-tremor-accordion" :open="routerOpen">
				<summary @click.prevent="routerOpen = !routerOpen">
					<b>Router Settings</b
					><svg
						class="access-team-accordion-arrow"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							d="M11.9999 13.1714L16.9497 8.22168L18.3639 9.63589L11.9999 15.9999L5.63599 9.63589L7.0502 8.22168L11.9999 13.1714Z"
						/>
					</svg>
				</summary>
				<div v-if="routerOpen"><RouterSettingsFormComponent v-model="router" :models="catalog.models" /></div>
			</details>
			<details class="access-tremor-accordion">
				<summary>
					<b>Model Aliases</b
					><svg
						class="access-team-accordion-arrow"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							d="M11.9999 13.1714L16.9497 8.22168L18.3639 9.63589L11.9999 15.9999L5.63599 9.63589L7.0502 8.22168L11.9999 13.1714Z"
						/>
					</svg>
				</summary>
				<div>
					<p class="access-muted">Create custom aliases for models that can be used by team members in API calls.</p>
					<ModelAliasesComponent v-model="aliases" :models="catalog.models" />
				</div>
			</details>
			<footer class="access-form-footer"><UiButton type="submit" :loading="pending">Create Team</UiButton></footer>
		</form></UiDialog
	>
</template>
