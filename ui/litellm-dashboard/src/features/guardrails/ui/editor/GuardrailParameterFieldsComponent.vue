<script setup lang="ts">
import { watch } from "vue";
import GuardrailFieldComponent from "../common/GuardrailFieldComponent.vue";
import GuardrailParameterControlComponent from "./GuardrailParameterControlComponent.vue";
import GuardrailDictionaryFieldComponent from "./GuardrailDictionaryFieldComponent.vue";
import type { ProviderParam } from "../../support/GuardrailModels";
defineOptions({ name: "GuardrailParameterFieldsComponent" });
const values = defineModel<Record<string, unknown>>({ required: true }),
	props = withDefaults(
		defineProps<{ fields: Record<string, ProviderParam>; prefix?: string; optional?: boolean; errors?: Record<string, string> }>(),
		{ prefix: "", optional: false, errors: () => ({}) },
	);
function key(name: string) {
	return props.prefix ? props.prefix + "." + name : name;
}
function update(name: string, value: unknown) {
	values.value = { ...values.value, [key(name)]: value };
}
function missing(name: string) {
	const value = values.value[key(name)];
	return value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
}
watch(
	() => props.fields,
	(fields) => {
		const next = { ...values.value };
		let changed = false;
		for (const [name, field] of Object.entries(fields)) {
			if (next[key(name)] === undefined && field.type !== "dict") {
				if (props.optional && field.default_value !== undefined) {
					next[key(name)] = field.default_value;
					changed = true;
				} else if (field.type === "percentage") {
					next[key(name)] = field.default_value ?? 0.5;
					changed = true;
				}
			}
		}
		if (changed) values.value = next;
	},
	{ immediate: true },
);
</script>
<template>
	<div>
		<template v-for="(field, name) in fields" :key="name"
			><div v-if="field.type === 'nested' && field.fields" class="guardrail-nested-field">
				<h4>{{ name }}</h4>
				<div>
					<GuardrailParameterFieldsComponent v-model="values" :fields="field.fields" :prefix="key(name)" :errors="errors" />
				</div>
			</div>
			<div v-else-if="optional && field.type === 'dict' && field.dict_key_options" class="guardrail-optional-dictionary">
				<h4>{{ name }}</h4>
				<p>{{ field.description }}</p>
				<GuardrailDictionaryFieldComponent
					:field="field"
					:model-value="values[key(name)]"
					@update:model-value="update(name, $event)"
				/>
			</div>
			<div v-else :class="{ 'guardrail-optional-field': optional }">
				<GuardrailFieldComponent
					:label="name"
					:required="field.required"
					:tooltip="optional ? undefined : field.description"
					:error="missing(name) ? errors[key(name)] : undefined"
					><p v-if="optional" class="guardrail-optional-description">{{ field.description }}</p>
					<GuardrailParameterControlComponent
						:field="field"
						:field-key="name"
						:model-value="values[key(name)]"
						:optional="optional"
						@update:model-value="update(name, $event)"
				/></GuardrailFieldComponent></div
		></template>
	</div>
</template>
