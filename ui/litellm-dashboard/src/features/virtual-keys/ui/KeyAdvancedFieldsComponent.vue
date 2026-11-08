<script setup lang="ts">
import { useKeyFieldIdentity } from "../support/KeyFormIdentity";
import { computed } from "vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import { markKeyField, selectedString, type KeyDraft, type KeySchemaProperty } from "../support/VirtualKeyModels";
import KeyField from "./KeyFieldComponent.vue";
const draft = defineModel<KeyDraft>({ required: true });
const props = withDefaults(defineProps<{ properties: Record<string, KeySchemaProperty>; errors?: Record<string, string> }>(), {
	errors: () => ({}),
});
const excluded = new Set([
	"key_alias",
	"team_id",
	"organization_id",
	"models",
	"duration",
	"metadata",
	"tags",
	"guardrails",
	"max_budget",
	"budget_duration",
	"tpm_limit",
	"rpm_limit",
	"key",
]);
const fields = computed(() => Object.entries(props.properties).filter(([name]) => !excluded.has(name)));
function kind(property: KeySchemaProperty) {
	if (property.type) return property.type;
	const types = property.anyOf?.map((value) => value.type) ?? [];
	return types.includes("number") || types.includes("integer") ? "number" : "string";
}
function isJson(name: string, property: KeySchemaProperty) {
	return ["metadata", "config", "enforced_params", "aliases"].includes(name) || property.format === "json";
}
function label(name: string, property: KeySchemaProperty) {
	return (
		property.title ||
		name
			.split("_")
			.map((value) => value.charAt(0).toUpperCase() + value.slice(1))
			.join(" ")
	);
}
function read(name: string): string | number | null {
	const known = (draft.value as unknown as Record<string, unknown>)[name];
	const meaningful =
		known !== null &&
		known !== undefined &&
		known !== "" &&
		known !== false &&
		(typeof known !== "object" || Object.keys(known).length > 0);
	const value = Object.prototype.hasOwnProperty.call(draft.value.advanced, name)
		? draft.value.advanced[name]
		: draft.value.presentFields.includes(name) || meaningful
			? known
			: null;
	return typeof value === "string" || typeof value === "number"
		? value
		: value == null
			? null
			: typeof value === "object"
				? JSON.stringify(value)
				: String(value);
}
function update(name: string, value: unknown, property: KeySchemaProperty) {
	if (["__proto__", "constructor", "prototype"].includes(name)) return;
	let next: unknown = value;
	if (kind(property) === "number" || kind(property) === "integer") next = typeof value === "number" ? value : null;
	if (kind(property) === "boolean" && (value === "true" || value === "false")) next = value === "true";
	markKeyField(draft.value, name);
	draft.value.advanced[name] = next;
	if (
		Object.prototype.hasOwnProperty.call(draft.value, name) &&
		!["aliases", "router_settings", "mcp_tool_permissions", "advanced"].includes(name)
	)
		Object.assign(draft.value, { [name]: next });
}
function help(name: string, property: KeySchemaProperty) {
	if (isJson(name, property)) return "Enter as JSON. Must be valid JSON format";
	if (property.enum) return "Select from available options. Allowed values: " + property.enum.join(", ");
	return (
		({ number: "Numeric input", integer: "Whole number input", boolean: "True/False value" } as Record<string, string>)[
			kind(property)
		] || "Text input"
	);
}
const fieldId = useKeyFieldIdentity();
</script>
<template>
	<div>
		<KeyField
			v-for="[name, property] in fields"
			:key="name"
			:name="name"
			:label="label(name, property)"
			:tooltip="property.description"
			:help="help(name, property)"
			:error="errors[name]"
			horizontal
			class="vk-advanced-field"
			><UiInput
				v-if="isJson(name, property)"
				:id="fieldId(name)"
				:model-value="read(name)"
				multiline
				:rows="4"
				placeholder="Enter as JSON"
				class="vk-mono-input"
				@update:model-value="update(name, $event, property)" /><UiSelect
				v-else-if="property.enum"
				:id="fieldId(name)"
				:model-value="read(name)"
				:options="property.enum.map((value) => ({ value: selectedString(value), label: String(value) }))"
				@update:model-value="update(name, $event, property)" /><UiInputNumber
				v-else-if="kind(property) === 'number' || kind(property) === 'integer'"
				:id="fieldId(name)"
				:model-value="typeof read(name) === 'number' ? Number(read(name)) : null"
				:precision="kind(property) === 'integer' ? 0 : undefined"
				@update:model-value="update(name, $event, property)" /><UiInput
				v-else
				:id="fieldId(name)"
				:model-value="read(name)"
				appearance="tremor"
				:placeholder="name === 'duration' ? 'eg: 30s, 30h, 30d' : property.description || ''"
				@update:model-value="update(name, $event, property)"
		/></KeyField>
	</div>
</template>
