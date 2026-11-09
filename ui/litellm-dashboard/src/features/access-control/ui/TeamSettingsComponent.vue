<script setup lang="ts">
import UiIcon from "../../platform/ui/UiIcon.vue";
import { ref, watch } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import TeamGeneralFieldsComponent from "./TeamGeneralFieldsComponent.vue";
import TeamAdvancedFieldsComponent from "./TeamAdvancedFieldsComponent.vue";
import PermissionSummaryComponent from "./PermissionSummaryComponent.vue";
import LoggingSummaryComponent from "./LoggingSummaryComponent.vue";
import { teamDraft, objectValue, stringList, parseMetadata } from "../logic/ResourceDraftLogic";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import type { AccessCatalog, AccessRecord, AccessTeam } from "../support/AccessModels";
const props = defineProps<{
	team: AccessTeam;
	catalog: AccessCatalog;
	editing: boolean;
	canEdit: boolean;
	premium?: boolean;
	pending?: boolean;
}>();
const emit = defineEmits<{ edit: []; cancel: []; submit: [draft: AccessRecord] }>();
const money = useMoneyFormatter(),
	draft = ref(teamDraft(props.team)),
	errors = ref<Record<string, string>>({});
watch(
	() => [props.team, props.editing],
	() => {
		draft.value = teamDraft(props.team);
		errors.value = {};
	},
);
function submit() {
	errors.value = {};
	if (!draft.value.team_alias) errors.value.team_alias = "Please input a team name";
	if (!stringList(draft.value.models).length) errors.value.models = "Please select at least one model";
	for (const key of ["metadata", "secret_manager_settings"]) {
		try {
			parseMetadata(draft.value[key], key);
		} catch {
			errors.value[key] = "Please enter valid JSON";
		}
	}
	if (!Object.keys(errors.value).length) emit("submit", { ...draft.value });
}
</script>
<template>
	<UiCard class="access-team-settings"
		><header>
			<h3>Team Settings</h3>
			<UiButton v-if="canEdit && !editing" @click="emit('edit')"
				><template #icon><UiIcon name="EditOutlined" /></template>Edit Settings</UiButton
			>
		</header>
		<form v-if="editing" @submit.prevent="submit">
			<TeamGeneralFieldsComponent v-model="draft" :catalog="catalog" :errors="errors" editing /><TeamAdvancedFieldsComponent
				v-model="draft"
				:premium="premium"
				:errors="errors"
				editing
				show-logging
			/>
			<footer class="access-sticky-footer">
				<UiButton :disabled="pending" @click="emit('cancel')">Cancel</UiButton
				><UiButton type="submit" variant="primary" :loading="pending"
					><template #icon><UiIcon name="SaveOutlined" /></template>Save Changes</UiButton
				>
			</footer>
		</form>
		<div v-else class="access-settings-summary">
			<div>
				<p>Team Name</p>
				{{ team.team_alias }}
			</div>
			<div>
				<p>Team ID</p>
				<code>{{ team.team_id }}</code>
			</div>
			<div>
				<p>Created At</p>
				{{ team.created_at ? new Date(team.created_at).toLocaleString() : "" }}
			</div>
			<div>
				<p>Models</p>
				<div class="access-tags">
					<UiTag v-for="model in team.models" :key="model" appearance="tremor" color="red">{{ model }}</UiTag>
				</div>
			</div>
			<div>
				<p>Rate Limits</p>
				<div>TPM: {{ team.tpm_limit || "Unlimited" }}</div>
				<div>RPM: {{ team.rpm_limit || "Unlimited" }}</div>
			</div>
			<div>
				<p>Team Budget</p>
				<div>Max Budget: {{ team.max_budget != null ? money(team.max_budget, 4) : "No Limit" }}</div>
				<div>Soft Budget: {{ team.soft_budget != null ? money(team.soft_budget, 4) : "No Limit" }}</div>
				<div>Budget Reset: {{ team.budget_duration || "Never" }}</div>
				<div v-if="stringList(team.metadata?.soft_budget_alerting_emails).length">
					Soft Budget Alerting Emails: {{ stringList(team.metadata?.soft_budget_alerting_emails).join(", ") }}
				</div>
			</div>
			<div>
				<p>Team Member Settings</p>
				<div>
					Max Budget:
					{{
						objectValue(team.team_member_budget_table).max_budget == null
							? "No Limit"
							: money(Number(objectValue(team.team_member_budget_table).max_budget))
					}}
				</div>
				<div>Budget Duration: {{ objectValue(team.team_member_budget_table).budget_duration || "No Limit" }}</div>
				<div>Key Duration: {{ team.metadata?.team_member_key_duration || "No Limit" }}</div>
				<div>TPM Limit: {{ objectValue(team.team_member_budget_table).tpm_limit || "No Limit" }}</div>
				<div>RPM Limit: {{ objectValue(team.team_member_budget_table).rpm_limit || "No Limit" }}</div>
			</div>
			<div>
				<p>Organization ID</p>
				{{ team.organization_id }}
			</div>
			<div>
				<p>Status</p>
				<UiTag appearance="tremor" :color="team.blocked ? 'red' : 'green'">{{ team.blocked ? "Blocked" : "Active" }}</UiTag>
			</div>
			<div>
				<p>Disable Global Guardrails</p>
				<UiTag appearance="tremor" :color="team.metadata?.disable_global_guardrails === true ? 'yellow' : 'green'">{{
					team.metadata?.disable_global_guardrails === true
						? "Enabled - Global guardrails bypassed"
						: "Disabled - Global guardrails active"
				}}</UiTag>
			</div>
			<PermissionSummaryComponent :permission="team.object_permission" inline /><LoggingSummaryComponent
				:configs="team.metadata?.logging"
				inline
			/>
			<div v-if="team.metadata?.secret_manager_settings">
				<p>Secret Manager Settings</p>
				<pre>{{ JSON.stringify(team.metadata.secret_manager_settings, null, 2) }}</pre>
			</div>
		</div></UiCard
	>
</template>
