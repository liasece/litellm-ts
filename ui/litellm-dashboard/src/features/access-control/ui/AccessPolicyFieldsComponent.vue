<script setup lang="ts">
import AccessFieldComponent from "./AccessFieldComponent.vue";
import type { AccessCatalog, AccessRecord } from "../support/AccessModels";
const draft = defineModel<AccessRecord>({ required: true });
defineProps<{ catalog: AccessCatalog; premium?: boolean; horizontal?: boolean }>();
</script>
<template>
	<div>
		<AccessFieldComponent
			v-model="draft.guardrails"
			name="team-guardrails"
			label="Guardrails"
			type="select"
			multiple
			creatable
			:options="catalog.guardrails"
			placeholder="Select or enter guardrails"
			help="Select existing guardrails or enter new ones"
			:horizontal="horizontal"
		/><AccessFieldComponent
			v-model="draft.disable_global_guardrails"
			name="team-disable-global-guardrails"
			label="Disable Global Guardrails"
			type="switch"
			:disabled="!premium"
			help="Bypass global guardrails for this team"
			:horizontal="horizontal"
		/><AccessFieldComponent
			v-model="draft.policies"
			name="team-policies"
			label="Policies"
			type="select"
			multiple
			creatable
			:options="catalog.policies"
			placeholder="Select or enter policies"
			help="Select existing policies or enter new ones"
			:horizontal="horizontal"
		/><AccessFieldComponent
			v-model="draft.access_group_ids"
			name="team-access-groups"
			label="Access Groups"
			type="select"
			multiple
			:options="catalog.groups"
			placeholder="Select access groups (optional)"
			:horizontal="horizontal"
		/>
	</div>
</template>
