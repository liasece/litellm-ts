<script setup lang="ts">
import { useKeyFieldIdentity } from "../support/KeyFormIdentity";
import UiInput from "../../platform/ui/UiInput.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import { selectedString, stringValues, markKeyField, type KeyDraft } from "../support/VirtualKeyModels";
import type { KeyField } from "../support/KeyFieldModels";
import { keyTypeFromRoutes } from "../logic/KeyDraftLogic";
import KeyFieldComponent from "./KeyFieldComponent.vue";
const draft = defineModel<KeyDraft>({ required: true });
const props = withDefaults(
	defineProps<{ editing?: boolean; fields: readonly KeyField[]; errors?: Record<string, string>; horizontal?: boolean }>(),
	{ errors: () => ({}) },
);
function update(field: KeyField, value: unknown) {
	markKeyField(draft.value, field.name);
	if (field.kind === "number") draft.value[field.name] = typeof value === "number" && Number.isFinite(value) ? value : null;
	else if (field.kind === "multiple") {
		const selected = stringValues(value);
		draft.value[field.name] = field.name === "models" && selected.includes("all-team-models") ? ["all-team-models"] : selected;
	} else if (field.kind === "switch") draft.value[field.name] = Boolean(value);
	else draft.value[field.name] = selectedString(value);
	if (props.editing && field.name === "key_type")
		draft.value.allowed_routes =
			({ default: "", llm_api: "llm_api_routes", management: "management_routes" } as Record<string, string>)[draft.value.key_type] ??
			draft.value.allowed_routes;
	if (props.editing && field.name === "allowed_routes")
		draft.value.key_type = keyTypeFromRoutes(draft.value.allowed_routes.split(",").map((value) => value.trim()));
	if (field.name === "key_type" && (draft.value.key_type === "management" || draft.value.key_type === "read_only"))
		draft.value.models = [];
}
const fieldId = useKeyFieldIdentity();
</script>
<template>
	<template v-for="field in fields" :key="field.name"
		><KeyFieldComponent
			:name="field.name"
			:label="field.label"
			:tooltip="field.tooltip"
			:tooltip-href="field.tooltipHref"
			:control-min-height="!editing && horizontal && field.kind === 'switch' ? 32 : undefined"
			:help="field.help"
			:error="errors[field.name]"
			:required="field.required"
			:horizontal="horizontal"
		>
			<UiInput
				v-if="field.kind === 'text' || field.kind === 'textarea'"
				:id="fieldId(field.name)"
				:model-value="draft[field.name]"
				:multiline="field.kind === 'textarea'"
				:rows="4"
				:appearance="field.tremor ? 'tremor' : 'antd'"
				:placeholder="field.placeholder"
				:disabled="field.disabled"
				:status="errors[field.name] ? 'error' : undefined"
				@update:model-value="update(field, $event)"
			/>
			<UiInputNumber
				v-else-if="field.kind === 'number'"
				:id="fieldId(field.name)"
				:model-value="draft[field.name]"
				:step="field.step ?? 1"
				:precision="field.tremor ? undefined : field.precision"
				:appearance="field.tremor ? 'tremor' : 'antd'"
				:disabled="field.disabled"
				placeholder="Enter a numerical value"
				style="width: 100%"
				@update:model-value="update(field, $event)"
			/>
			<UiSelect
				v-else-if="field.kind === 'select'"
				:id="fieldId(field.name)"
				:model-value="draft[field.name] || null"
				:options="field.options"
				:clearable="field.clearable"
				:placeholder="field.placeholder || 'Select ' + field.label.toLowerCase()"
				:disabled="field.disabled"
				@update:model-value="update(field, $event)"
			/>
			<UiSelect
				v-else-if="field.kind === 'multiple'"
				:id="fieldId(field.name)"
				:model-value="editing && field.name === 'models' && field.disabled ? [] : draft[field.name]"
				:options="field.options"
				multiple
				searchable
				clearable
				:creatable="field.creatable"
				:token-separators="field.name === 'tags' && !editing ? [','] : undefined"
				:placeholder="field.placeholder || 'Select ' + field.label.toLowerCase()"
				:disabled="field.disabled"
				@update:model-value="update(field, $event)"
			/>
			<UiSwitch
				v-else-if="field.kind === 'switch'"
				:model-value="draft[field.name]"
				:label="field.label"
				:disabled="field.disabled"
				@update:model-value="update(field, $event)"
				><template v-if="editing && field.name === 'disable_global_guardrails'" #default>{{
					draft[field.name] ? "Yes" : "No"
				}}</template></UiSwitch
			>
		</KeyFieldComponent>
		<div v-if="horizontal && !editing && (field.help || errors[field.name])" class="vk-create-field-margin-offset" aria-hidden="true"
	/></template>
</template>
