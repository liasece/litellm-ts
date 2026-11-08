<script setup lang="ts">
import { computed } from "vue";
import UiFormField from "../../platform/ui/UiFormField.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import type { UiAppearance, UiControlSize } from "../../platform/ui/UiTypes";
import type { ResourceOption } from "../support/AccessModels";
const props = withDefaults(
	defineProps<{
		modelValue: unknown;
		inputAppearance?: UiAppearance;
		size?: UiControlSize;
		precision?: number;
		searchable?: boolean;
		clearable?: boolean;
		showOptionDescription?: boolean;
		name?: string;
		label?: string;
		type?: "text" | "textarea" | "number" | "select" | "switch";
		options?: ResourceOption[];
		multiple?: boolean;
		maxTagCount?: number | "responsive";
		creatable?: boolean;
		placeholder?: string;
		disabled?: boolean;
		required?: boolean;
		error?: string;
		help?: string;
		tooltip?: string;
		tooltipIcon?: string;
		horizontal?: boolean;
		rows?: number;
		min?: number;
		step?: number;
	}>(),
	{
		inputAppearance: "antd",
		maxTagCount: undefined,
		size: "middle",
		precision: undefined,
		searchable: true,
		clearable: true,
		label: undefined,
		name: undefined,
		placeholder: undefined,
		error: undefined,
		help: undefined,
		tooltip: undefined,
		tooltipIcon: "QuestionCircleOutlined",
		min: undefined,
		step: undefined,
		type: "text",
		options: () => [],
		rows: 4,
	},
);
const emit = defineEmits<{ "update:modelValue": [value: unknown]; change: [value: unknown] }>();
const inputValue = computed(() => (typeof props.modelValue === "string" || typeof props.modelValue === "number" ? props.modelValue : null));
const numericValue = computed(() => (typeof props.modelValue === "number" ? props.modelValue : null));
const selectValue = computed(() =>
	Array.isArray(props.modelValue)
		? props.modelValue.filter((value): value is string | number => typeof value === "string" || typeof value === "number")
		: inputValue.value === "" && !props.options.some((option) => option.value === "")
			? undefined
			: inputValue.value,
);
function update(value: unknown) {
	emit("update:modelValue", value);
	emit("change", value);
}
</script>
<template>
	<UiFormField :for="name" :label="label" :required="required" :error="error" :help="help" :horizontal="horizontal">
		<template v-if="$slots.label || tooltip" #label
			><slot name="label"
				>{{ label
				}}<UiTooltip v-if="tooltip" :title="tooltip"><UiIcon :name="tooltipIcon" class="access-field-tooltip" /></UiTooltip></slot
		></template>
		<UiSelect
			v-if="type === 'select'"
			:id="name"
			:size="size"
			:model-value="selectValue"
			:options="options"
			:multiple="multiple"
			:max-tag-count="maxTagCount"
			:creatable="creatable"
			:searchable="searchable"
			:clearable="clearable"
			:placeholder="placeholder"
			:disabled="disabled"
			:status="error ? 'error' : undefined"
			@update:model-value="update"
			><template v-if="$slots.value || showOptionDescription" #value="{ option }"
				><slot name="value" :option="option"
					><span class="access-role-option"
						>{{ option.label }}<small>{{ option.description }}</small></span
					></slot
				></template
			><template v-if="$slots.option || showOptionDescription" #option="{ option }"
				><slot name="option" :option="option"
					><span class="access-role-option"
						>{{ option.label }}<small>{{ option.description }}</small></span
					></slot
				></template
			><template v-if="$slots.overflow" #overflow="{ options: omitted, count }"
				><slot name="overflow" :options="omitted" :count="count" /></template
		></UiSelect>
		<UiSwitch
			v-else-if="type === 'switch'"
			:id="name"
			:model-value="Boolean(modelValue)"
			:disabled="disabled"
			@update:model-value="update"
		/>
		<UiInputNumber
			v-else-if="type === 'number'"
			:appearance="inputAppearance"
			:precision="precision"
			:id="name"
			:size="size"
			:model-value="numericValue"
			:min="min"
			:step="step"
			:placeholder="placeholder"
			:disabled="disabled"
			@update:model-value="update"
		/>
		<UiInput
			v-else
			:appearance="inputAppearance"
			:id="name"
			:size="size"
			:model-value="inputValue"
			:multiline="type === 'textarea'"
			:rows="rows"
			:placeholder="placeholder"
			:disabled="disabled"
			:status="error ? 'error' : undefined"
			@update:model-value="update"
		/>
	</UiFormField>
</template>
