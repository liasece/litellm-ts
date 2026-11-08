<script setup lang="ts">
import { ref, computed } from "vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiInputNumber from "../../../platform/ui/UiInputNumber.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import type { ProviderParam } from "../../support/GuardrailModels";
const props = defineProps<{ field: ProviderParam; modelValue: unknown }>(),
	emit = defineEmits<{ "update:modelValue": [value: unknown] }>(),
	record = computed<Record<string, unknown>>(() =>
		props.modelValue && typeof props.modelValue === "object" && !Array.isArray(props.modelValue)
			? (props.modelValue as Record<string, unknown>)
			: {},
	),
	entries = ref(Object.keys(record.value)),
	available = computed(() => (props.field.dict_key_options ?? []).filter((key) => !entries.value.includes(key)));
function add(value: unknown) {
	if (typeof value === "string" && value && !entries.value.includes(value)) entries.value.push(value);
}
function update(key: string, value: unknown) {
	emit("update:modelValue", { ...record.value, [key]: value === "" || value === null ? undefined : value });
}
function booleanValue(key: string, value: unknown) {
	update(key, value === "true");
}
function textValue(key: string) {
	const value = record.value[key];
	return value == null ? "" : String(value);
}
</script>
<template>
	<div class="guardrail-dictionary">
		<div v-for="key in entries" :key="key" class="guardrail-dictionary-entry">
			<label>{{ key }}</label>
			<div>
				<UiInputNumber
					v-if="field.dict_value_type === 'number'"
					:model-value="record[key] === undefined ? undefined : Number(record[key])"
					:step="1"
					style="width: 200px"
					:placeholder="'Enter ' + key + ' value'"
					@update:model-value="update(key, $event)"
				/><UiSelect
					v-else-if="field.dict_value_type === 'boolean'"
					:model-value="record[key] === undefined ? null : String(record[key])"
					:options="[
						{ value: 'true', label: 'True' },
						{ value: 'false', label: 'False' },
					]"
					:placeholder="'Select ' + key + ' value'"
					@update:model-value="booleanValue(key, $event)"
				/><UiInput
					v-else
					:model-value="textValue(key)"
					:placeholder="'Enter ' + key + ' value'"
					@update:model-value="update(key, $event)"
				/>
			</div>
			<UiButton variant="text" danger size="small" @click="entries = entries.filter((value) => value !== key)">Remove</UiButton>
		</div>
		<div v-if="available.length" class="guardrail-dictionary-add">
			<UiSelect
				:model-value="null"
				:options="available.map((value) => ({ value, label: value }))"
				placeholder="Select category to configure"
				style="width: 200px"
				@update:model-value="add"
			/><span>Select a category to add threshold configuration</span>
		</div>
	</div>
</template>
