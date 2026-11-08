<script setup lang="ts">
import { computed } from "vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiInputNumber from "../../../platform/ui/UiInputNumber.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import type { ProviderParam } from "../../support/GuardrailModels";
const props = defineProps<{ field: ProviderParam; fieldKey: string; modelValue: unknown; optional?: boolean; disabled?: boolean }>(),
	emit = defineEmits<{ "update:modelValue": [value: unknown] }>(),
	display = computed(() =>
		props.modelValue !== undefined && props.modelValue !== null
			? props.modelValue
			: props.optional
				? undefined
				: props.field.default_value,
	),
	text = computed(() => (display.value == null ? "" : String(display.value))),
	number = computed(() => (display.value == null ? undefined : Number(display.value)));
function update(value: unknown) {
	emit("update:modelValue", value);
}
function range(event: Event) {
	update(Number((event.target as HTMLInputElement).value));
}
</script>
<template>
	<UiSelect
		v-if="(field.type === 'select' || field.type === 'multiselect') && field.options"
		:model-value="
			Array.isArray(display)
				? display.filter((value): value is string => typeof value === 'string')
				: typeof display === 'string' || typeof display === 'number'
					? display
					: null
		"
		:options="field.options.map((value) => ({ value, label: value }))"
		:multiple="field.type === 'multiselect'"
		:placeholder="field.description"
		:disabled="disabled"
		@update:model-value="update"
	/><UiSelect
		v-else-if="field.type === 'bool' || field.type === 'boolean'"
		:model-value="display == null ? null : String(display)"
		:options="[
			{ value: 'true', label: 'True' },
			{ value: 'false', label: 'False' },
		]"
		:placeholder="field.description"
		:disabled="disabled"
		@update:model-value="update"
	/>
	<div v-else-if="field.type === 'percentage' && field.min != null && field.max != null" class="guardrail-percentage">
		<input
			type="range"
			:value="number ?? field.default_value ?? 0.5"
			:min="field.min"
			:max="field.max"
			:step="field.step ?? 0.1"
			:disabled="disabled"
			@input="range"
		/>
		<div><span>0%</span><span>50%</span><span>100%</span></div>
	</div>
	<UiInputNumber
		v-else-if="field.type === 'number'"
		:model-value="number"
		:step="1"
		:placeholder="field.description"
		:disabled="disabled"
		style="width: 400px"
		@update:model-value="update"
	/><UiInput
		v-else
		:model-value="text"
		:type="fieldKey.includes('password') || fieldKey.includes('secret') || fieldKey.includes('key') ? 'password' : 'text'"
		:visibility-toggle="fieldKey.includes('password') || fieldKey.includes('secret') || fieldKey.includes('key')"
		:placeholder="field.description"
		:disabled="disabled"
		@update:model-value="update"
	/>
</template>
