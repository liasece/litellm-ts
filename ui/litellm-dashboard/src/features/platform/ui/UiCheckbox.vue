<script setup lang="ts">
withDefaults(defineProps<{ modelValue?: boolean; disabled?: boolean; indeterminate?: boolean; label?: string }>(), {
	modelValue: false,
	label: undefined,
});
defineEmits<{ "update:modelValue": [value: boolean] }>();
</script>

<template>
	<label class="ui-checkbox" :class="{ 'ui-checkbox--disabled': disabled }"
		><input
			type="checkbox"
			:checked="modelValue"
			:disabled="disabled"
			:indeterminate="indeterminate"
			:aria-label="label"
			@change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)" /><span v-if="$slots.default"><slot /></span
	></label>
</template>
