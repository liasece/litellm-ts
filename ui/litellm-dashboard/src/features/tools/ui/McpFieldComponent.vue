<script setup lang="ts">
import { computed } from "vue";
import UiFormField from "../../platform/ui/UiFormField.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import ToolPasswordInputComponent from "./ToolPasswordInputComponent.vue";
const props = withDefaults(
	defineProps<{
		modelValue: unknown;
		label?: string;
		name?: string;
		tooltip?: string;
		required?: boolean;
		error?: string;
		help?: string;
		type?: "text" | "password" | "textarea" | "number" | "select" | "switch";
		options?: { value: string | number; label: string; description?: string }[];
		multiple?: boolean;
		creatable?: boolean;
		searchable?: boolean;
		clearable?: boolean;
		placeholder?: string;
		rows?: number;
		appearance?: "antd" | "tremor";
		showPassword?: boolean;
		disabled?: boolean;
		size?: "small" | "middle" | "large";
	}>(),
	{
		type: "text",
		rows: 4,
		options: () => [],
		appearance: "antd",
		searchable: true,
		clearable: true,
		size: "middle",
		label: undefined,
		name: undefined,
		tooltip: undefined,
		error: undefined,
		help: undefined,
		placeholder: undefined,
	},
);
const emit = defineEmits<{ "update:modelValue": [value: unknown]; change: [value: unknown] }>();
const text = computed(() => (typeof props.modelValue === "string" || typeof props.modelValue === "number" ? props.modelValue : null)),
	selected = computed(() =>
		Array.isArray(props.modelValue)
			? props.modelValue.filter((item): item is string | number => typeof item === "string" || typeof item === "number")
			: text.value,
	);
function update(value: unknown) {
	emit("update:modelValue", value);
	emit("change", value);
}
</script>
<template>
	<UiFormField :for="name" :label="label" :required="required" :error="error" :help="help" class="tools-mcp-field"
		><template v-if="label" #label
			>{{ label }}<UiTooltip v-if="tooltip" :title="tooltip"><UiIcon name="InfoCircleOutlined" :size="14" /></UiTooltip></template
		><UiSelect
			v-if="type === 'select'"
			:id="name"
			:model-value="selected"
			:options="options"
			:multiple="multiple"
			:creatable="creatable"
			:size="size"
			:disabled="disabled"
			:placeholder="placeholder"
			:searchable="searchable"
			:clearable="clearable"
			:token-separators="creatable ? [','] : undefined"
			@update:model-value="update" /><UiSwitch
			v-else-if="type === 'switch'"
			:id="name"
			:model-value="Boolean(modelValue)"
			:disabled="disabled"
			@update:model-value="update" /><UiInputNumber
			v-else-if="type === 'number'"
			:id="name"
			:model-value="typeof modelValue === 'number' ? modelValue : null"
			:placeholder="placeholder"
			:disabled="disabled"
			@update:model-value="update" /><ToolPasswordInputComponent
			v-else-if="type === 'password' && showPassword"
			:id="name"
			:model-value="text"
			:placeholder="placeholder"
			@update:model-value="update" /><UiInput
			v-else
			:id="name"
			:model-value="text"
			:type="type === 'password' ? 'password' : 'text'"
			:multiline="type === 'textarea'"
			:rows="rows"
			:appearance="appearance"
			:size="size"
			:placeholder="placeholder"
			:disabled="disabled"
			:status="error ? 'error' : undefined"
			@update:model-value="update"
	/></UiFormField>
</template>
