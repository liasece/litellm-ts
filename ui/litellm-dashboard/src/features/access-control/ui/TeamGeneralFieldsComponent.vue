<script setup lang="ts">
import { computed } from "vue";
import AccessFieldComponent from "./AccessFieldComponent.vue";
import AccessModelOverflowComponent from "./AccessModelOverflowComponent.vue";
import { teamGeneralFields, teamEditExtraFields, budgetDurationOptions } from "../support/TeamFields";
import { stringList } from "../logic/ResourceDraftLogic";
import type { AccessCatalog, AccessRecord, ResourceOption } from "../support/AccessModels";
const draft = defineModel<AccessRecord>({ required: true });
const props = defineProps<{ catalog: AccessCatalog; editing?: boolean; errors?: Record<string, string>; hideName?: boolean }>();
const fields = computed(() => {
	const result = teamGeneralFields.filter((field) => !props.hideName || field.name !== "team_alias");
	if (props.editing) {
		result.splice(
			result.findIndex((field) => field.name === "team_member_budget"),
			0,
			...teamEditExtraFields.slice(0, 2),
		);
		result.splice(
			result.findIndex((field) => field.name === "team_member_key_duration"),
			0,
			teamEditExtraFields[2],
		);
	}
	return result;
});
const tooltips: Record<string, string> = {
	team_member_budget: "This is the individual budget for a user in the team.",
	team_member_key_duration:
		"Set a limit to the duration of a team member's key. Format: 30s (seconds), 30m (minutes), 30h (hours), 30d (days), 1mo (month)",
	team_member_tpm_limit:
		"Default tokens per minute limit for an individual team member. This limit applies to all requests the user makes within this team. Can be overridden per member.",
	team_member_rpm_limit:
		"Default requests per minute limit for an individual team member. This limit applies to all requests the user makes within this team. Can be overridden per member.",
	soft_budget_alerting_emails: "Comma-separated email addresses to receive alerts when the soft budget is reached",
};
function options(name: string): ResourceOption[] {
	if (name === "models") {
		const org = props.catalog.organizations.find((value) => value.organization_id === draft.value.organization_id),
			allowed = org?.models;
		return [
			{ value: "all-proxy-models", label: "All Proxy Models" },
			{ value: "no-default-models", label: "No Default Models" },
			...(allowed?.length && !allowed.includes("all-proxy-models")
				? allowed.map((value) => ({ value, label: value }))
				: props.catalog.models),
		];
	}
	return budgetDurationOptions;
}
function change(name: string) {
	if (name === "models" && stringList(draft.value.models).includes("all-proxy-models")) draft.value.models = ["all-proxy-models"];
}
</script>
<template>
	<div>
		<AccessFieldComponent
			v-for="field in fields"
			:key="field.name"
			v-model="draft[field.name]"
			:name="'team-' + field.name"
			:label="field.label"
			:type="field.type"
			:input-appearance="field.type === 'number' || field.name === 'team_member_key_duration' ? 'tremor' : 'antd'"
			:precision="field.step === 0.01 ? 2 : undefined"
			:required="field.required"
			:placeholder="
				field.placeholder ||
				(field.type === 'number' ? 'Enter a numerical value' : field.name === 'models' ? 'Select Models' : undefined)
			"
			:tooltip="tooltips[field.name]"
			:step="field.step"
			:multiple="field.name === 'models'"
			:max-tag-count="field.name === 'models' ? 'responsive' : undefined"
			:options="options(field.name)"
			:horizontal="!editing"
			:error="errors?.[field.name]"
			@change="change(field.name)"
			><template v-if="field.name === 'models'" #overflow="{ options: omitted, count }"
				><AccessModelOverflowComponent :options="omitted" :count="count" /></template
		></AccessFieldComponent>
	</div>
</template>
