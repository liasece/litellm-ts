<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { PlaygroundMcpTool } from "../../support/PlaygroundModels";
import { initialToolArguments, toolArgumentSchema, validateToolArguments } from "../../logic/PlaygroundToolArgumentsLogic";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiInputNumber from "../../../platform/ui/UiInputNumber.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import type { UiValue } from "../../../platform/ui/UiTypes";
const props = defineProps<{ tool: PlaygroundMcpTool }>();
const schema = computed(() => toolArgumentSchema(props.tool)),
	values = ref<Record<string, unknown>>({}),
	errors = ref<Record<string, string>>({});
watch(
	schema,
	() => {
		values.value = initialToolArguments(schema.value.actual);
		errors.value = {};
	},
	{ immediate: true },
);
function text(key: string) {
	const value = values.value[key];
	return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}
function number(key: string) {
	const value = values.value[key];
	return typeof value === "number" ? value : null;
}
function select(key: string, value: UiValue | UiValue[] | null) {
	values.value = { ...values.value, [key]: value };
}
function set(key: string, value: unknown) {
	values.value = { ...values.value, [key]: value };
}
function getSubmitValues() {
	const result = validateToolArguments(values.value, props.tool);
	errors.value = result.errors;
	if (Object.keys(result.errors).length) throw new Error(Object.values(result.errors)[0]);
	return result.data;
}
defineExpose({ getSubmitValues });
</script>
<template>
	<div class="pg-tool-form">
		<div v-if="!schema.actual.properties" class="pg-tool-form__empty">No parameters required for this tool.</div>
		<label v-for="(property, key) in schema.actual.properties" :key="tool.name + '-' + key" class="pg-tool-field"
			><span
				><span v-if="schema.actual.required?.includes(key)" class="pg-required-leading" aria-hidden="true">*</span
				>{{ schema.stringInput ? "Input" : key }} <span v-if="schema.actual.required?.includes(key)" class="pg-error">*</span
				><UiTooltip v-if="property.description" :title="property.description"><UiIcon name="InfoCircleOutlined" /></UiTooltip
			></span>
			<UiSelect
				v-if="property.type === 'string' && property.enum"
				:model-value="text(key) || null"
				:options="property.enum.map((value) => ({ value: String(value), label: String(value) }))"
				:placeholder="'Select ' + key"
				:clearable="!schema.actual.required?.includes(key)"
				@update:model-value="select(key, $event)"
			/>
			<UiInputNumber
				v-else-if="property.type === 'number' || property.type === 'integer'"
				:model-value="number(key)"
				:step="property.type === 'integer' ? 1 : undefined"
				:placeholder="property.description || 'Enter ' + key"
				@update:model-value="set(key, $event)"
			/>
			<UiSelect
				v-else-if="property.type === 'boolean'"
				:model-value="String(values[key])"
				:options="[
					{ value: 'true', label: 'True' },
					{ value: 'false', label: 'False' },
				]"
				:placeholder="'Select ' + key"
				:clearable="!schema.actual.required?.includes(key)"
				@update:model-value="select(key, $event)"
			/>
			<UiInput
				v-else
				:model-value="text(key)"
				:multiline="property.type === 'object' || property.type === 'array'"
				:rows="property.type === 'object' ? 4 : 3"
				:clearable="property.type !== 'object' && property.type !== 'array'"
				:placeholder="
					property.description ||
					(property.type === 'object'
						? 'Enter JSON object for ' + key
						: property.type === 'array'
							? 'Enter JSON array for ' + key
							: 'Enter ' + key)
				"
				:spellcheck="false"
				:class="{ 'pg-mono': property.type === 'object' || property.type === 'array' }"
				@update:model-value="set(key, $event)"
			/>
			<span v-if="errors[key]" class="pg-error">{{ errors[key] }}</span>
		</label>
	</div>
</template>
