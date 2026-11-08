<script setup lang="ts">
import UiAlert from "../../../platform/ui/UiAlert.vue";
import UiFormField from "../../../platform/ui/UiFormField.vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import PolicySelectComponent from "../common/PolicySelectComponent.vue";
import PolicyRadioComponent from "../common/PolicyRadioComponent.vue";
import type { PolicySimpleForm } from "../../support/PolicyModels";
defineProps<{ form: PolicySimpleForm; conditionType: string; models: string[] }>();
defineEmits<{ "update:conditionType": [value: string]; condition: [value: string] }>();
</script>
<template>
	<UiAlert title="Model Scope" class="policy-mb16"
		>By default, this policy will run on all models. You can optionally restrict it to specific models below.</UiAlert
	>
	<UiFormField label="Model Condition Type"
		><div class="policy-radios">
			<PolicyRadioComponent
				:model-value="conditionType"
				value="model"
				@update:model-value="
					$emit('update:conditionType', $event);
					$emit('condition', '');
				"
				>Select Model</PolicyRadioComponent
			><PolicyRadioComponent
				:model-value="conditionType"
				value="regex"
				@update:model-value="
					$emit('update:conditionType', $event);
					$emit('condition', '');
				"
				>Custom Regex Pattern</PolicyRadioComponent
			>
		</div></UiFormField
	>
	<UiFormField :label="conditionType === 'model' ? 'Model (Optional)' : 'Regex Pattern (Optional)'">
		<PolicySelectComponent
			v-if="conditionType === 'model'"
			:model-value="form.model_condition"
			@update:model-value="$emit('condition', String($event ?? ''))"
			:options="models.map((value) => ({ value, label: value }))"
			searchable
			clearable
			placeholder="Leave empty to apply to all models"
		/>
		<UiInput
			v-else
			:model-value="form.model_condition"
			@update:model-value="$emit('condition', String($event ?? ''))"
			appearance="tremor"
			placeholder="Leave empty to apply to all models (e.g., gpt-4.* or bedrock/claude-.*)"
		/>
	</UiFormField>
</template>
