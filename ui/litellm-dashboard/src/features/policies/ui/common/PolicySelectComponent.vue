<script setup lang="ts" generic="T extends string | string[]">
import { computed } from "vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import type { UiSelectOption, UiValue } from "../../../platform/ui/UiTypes";
const props = defineProps<{
	modelValue: T;
	options: readonly UiSelectOption[];
	placeholder?: string;
	multiple?: boolean;
	creatable?: boolean;
	searchable?: boolean;
	clearable?: boolean;
	loading?: boolean;
	disabled?: boolean;
	size?: "small" | "middle" | "large";
	tokenSeparators?: readonly string[];
}>();
const emit = defineEmits<{ "update:modelValue": [value: T]; change: [value: T] }>();
const selected = computed<string | string[] | null>(() =>
	Array.isArray(props.modelValue) ? props.modelValue.map(String) : String(props.modelValue) || null,
);
function update(value: UiValue | UiValue[] | null) {
	const next = (Array.isArray(value) ? value.map(String) : value === null ? "" : String(value)) as T;
	emit("update:modelValue", next);
	emit("change", next);
}
</script>
<template>
	<UiSelect
		:model-value="selected"
		:options="options"
		:placeholder="placeholder"
		:multiple="multiple"
		:creatable="creatable"
		:searchable="searchable"
		:clearable="clearable"
		:loading="loading"
		:disabled="disabled"
		:size="size"
		:token-separators="tokenSeparators"
		@update:model-value="update"
	/>
</template>
