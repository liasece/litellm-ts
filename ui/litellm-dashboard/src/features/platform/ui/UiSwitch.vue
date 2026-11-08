<script setup lang="ts">
import type { UiAppearance } from "./UiTypes";
withDefaults(
	defineProps<{
		modelValue?: boolean;
		disabled?: boolean;
		loading?: boolean;
		size?: "small" | "middle";
		appearance?: UiAppearance;
		label?: string;
	}>(),
	{
		size: "middle",
		appearance: "antd",
		label: undefined,
	},
);
defineEmits<{ "update:modelValue": [value: boolean] }>();
</script>

<template>
	<button
		type="button"
		role="switch"
		class="ui-switch"
		:class="['ui-switch--' + size, 'ui-switch--' + appearance, { 'ui-switch--checked': modelValue }]"
		:disabled="disabled || loading"
		:aria-checked="Boolean(modelValue)"
		:aria-label="label"
		@click="$emit('update:modelValue', !modelValue)"
	>
		<span class="ui-switch__handle" /><span v-if="$slots.default" class="ui-switch__label"><slot /></span>
	</button>
</template>
