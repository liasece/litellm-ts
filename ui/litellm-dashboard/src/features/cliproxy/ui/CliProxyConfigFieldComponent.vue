<script setup lang="ts">
import UiInput from "../../platform/ui/UiInput.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import type { FieldDefinition } from "../support/ConfigurationFields";
const props = defineProps<{ field: FieldDefinition; modelValue: string | number | null }>();
const emit = defineEmits<{ "update:modelValue": [value: string | number | null] }>();
function update(value: string | number | null) {
	if (props.field.type !== "number" || value !== null || props.field.key === "authAutoRefreshWorkers")
		return emit("update:modelValue", value);
	emit("update:modelValue", props.field.key === "redisUsageQueueRetentionSeconds" ? 60 : 0);
}
</script>
<template>
	<label class="cp-field"
		><span class="cp-field-label">{{ field.label }}</span
		><UiSelect
			v-if="field.type === 'select'"
			:model-value="modelValue"
			:options="field.options ?? []"
			@update:model-value="update($event as string | number | null)"
		/><UiInputNumber
			v-else-if="field.type === 'number'"
			:model-value="typeof modelValue === 'number' ? modelValue : null"
			:min="field.min"
			:max="field.max"
			:placeholder="field.placeholder"
			@update:model-value="update"
		/>
		<UiInput
			v-else
			:model-value="modelValue"
			type="text"
			:min="field.min"
			:max="field.max"
			:placeholder="field.placeholder"
			@update:model-value="update"
		/><span class="cp-field-description cp-secondary">{{ field.description }}</span></label
	>
</template>
