<script setup lang="ts">
import AccessFieldComponent from "./AccessFieldComponent.vue";
import AccessModelOverflowComponent from "./AccessModelOverflowComponent.vue";
import AccessResourcesComponent from "./AccessResourcesComponent.vue";
import { organizationFields, budgetDurationOptions } from "../support/TeamFields";
import type { AccessCatalog, AccessRecord } from "../support/AccessModels";
const draft = defineModel<AccessRecord>({ required: true });
defineProps<{ catalog: AccessCatalog; editing?: boolean; errors?: Record<string, string> }>();
</script>
<template>
	<div>
		<AccessFieldComponent
			v-for="field in organizationFields"
			:key="field.name"
			v-model="draft[field.name]"
			:name="'organization-' + field.name"
			:label="field.label"
			:type="field.type"
			:required="field.required"
			:step="field.step"
			:placeholder="
				field.placeholder ||
				(!editing
					? field.type === 'number'
						? 'Enter a numerical value'
						: field.name === 'organization_alias'
							? 'Type...'
							: field.name === 'models'
								? 'Select Models'
								: undefined
					: undefined)
			"
			:input-appearance="field.type === 'number' || field.name === 'organization_alias' ? 'tremor' : 'antd'"
			:options="
				field.name === 'models'
					? [
							{ value: 'all-proxy-models', label: 'All Proxy Models' },
							{ value: 'no-default-models', label: 'No Default Models' },
							...catalog.models,
						]
					: budgetDurationOptions
			"
			:multiple="field.name === 'models'"
			:max-tag-count="field.name === 'models' ? 'responsive' : undefined"
			:error="errors?.[field.name]"
			:horizontal="!editing"
			><template v-if="field.name === 'models'" #overflow="{ options: omitted, count }"
				><AccessModelOverflowComponent :options="omitted" :count="count" /></template></AccessFieldComponent
		><AccessResourcesComponent v-model="draft" :catalog="catalog" organization :editing="editing" /><AccessFieldComponent
			v-model="draft.metadata"
			name="organization-metadata"
			label="Metadata"
			type="textarea"
			:horizontal="!editing"
			:error="errors?.metadata"
		/>
	</div>
</template>
