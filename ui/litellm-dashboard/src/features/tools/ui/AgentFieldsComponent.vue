<script setup lang="ts">
import { computed } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiFormField from "../../platform/ui/UiFormField.vue";
import AccessFieldComponent from "../../access-control/ui/AccessFieldComponent.vue";
import ToolPasswordInputComponent from "./ToolPasswordInputComponent.vue";
import { AGENT_FORM_CONFIG, SKILL_FIELD_CONFIG } from "../support/AgentFieldSupport";
import type { AgentTypeInfo } from "../support/AgentModels";
const draft = defineModel<Record<string, unknown>>({ required: true });
defineProps<{ typeInfo?: AgentTypeInfo; dynamic?: boolean; credentialsOnly?: boolean; errors?: Record<string, string> }>();
const skills = computed(() => (Array.isArray(draft.value.skills) ? (draft.value.skills as Record<string, unknown>[]) : [])),
	headers = computed(() => (Array.isArray(draft.value.static_headers) ? (draft.value.static_headers as Record<string, unknown>[]) : []));
function addSkill() {
	draft.value.skills = [...skills.value, {}];
}
function removeSkill(index: number) {
	draft.value.skills = skills.value.filter((_, i) => i !== index);
}
function addHeader() {
	draft.value.static_headers = [...headers.value, {}];
}
function removeHeader(index: number) {
	draft.value.static_headers = headers.value.filter((_, i) => i !== index);
}
function text(value: unknown) {
	return Array.isArray(value) ? value.join(", ") : String(value || "");
}
function list(value: unknown, filter: boolean) {
	const values = String(value || "")
		.split(",")
		.map((item) => item.trim());
	return filter ? values.filter(Boolean) : values;
}
</script>
<template>
	<AccessFieldComponent
		v-if="!credentialsOnly"
		v-model="draft.agent_name"
		name="agent-name"
		label="Agent Name"
		required
		tooltip="Unique identifier for the agent"
		:placeholder="dynamic ? 'e.g., my-langgraph-agent' : 'e.g., customer-support-agent'"
		:error="errors?.agent_name"
	/><template v-if="dynamic"
		><AccessFieldComponent
			v-if="!credentialsOnly"
			v-model="draft.description"
			name="agent-description"
			label="Description"
			tooltip="Brief description of what this agent does"
			type="textarea"
			:rows="2"
			placeholder="Describe what this agent does..." /><template v-for="field in typeInfo?.credential_fields || []" :key="field.key"
			><UiFormField
				v-if="field.field_type === 'password'"
				:for="'agent-' + field.key"
				:label="field.label"
				:required="field.required"
				:error="errors?.[field.key]"
				><ToolPasswordInputComponent
					:id="'agent-' + field.key"
					:model-value="text(draft[field.key])"
					:placeholder="field.placeholder || ''"
					@update:model-value="draft[field.key] = $event" /></UiFormField
			><AccessFieldComponent
				v-else
				v-model="draft[field.key]"
				:name="'agent-' + field.key"
				:label="field.label"
				:required="field.required"
				:tooltip="field.tooltip || undefined"
				:type="field.field_type === 'select' ? 'select' : field.field_type === 'textarea' ? 'textarea' : 'text'"
				:rows="3"
				:options="field.options?.map((value) => ({ value, label: value }))"
				:placeholder="field.placeholder || ''"
				:error="errors?.[field.key]" /></template
	></template>
	<div v-if="!credentialsOnly" class="tools-agent-panels">
		<template v-if="!dynamic"
			><details open>
				<summary>Basic Information (Required)</summary>
				<div>
					<AccessFieldComponent
						v-for="field in AGENT_FORM_CONFIG.basic.fields"
						:key="field.name"
						v-model="draft[field.name]"
						:name="'agent-' + field.name"
						:label="field.label"
						:required="field.required"
						:tooltip="field.tooltip"
						:type="field.type === 'textarea' ? 'textarea' : 'text'"
						:rows="field.rows || 4"
						:placeholder="field.placeholder"
						:error="errors?.[field.name]"
					/>
				</div>
			</details>
			<details>
				<summary>Skills (Required)</summary>
				<div>
					<section v-for="(skill, index) in skills" :key="index" class="tools-agent-skill">
						<template v-for="field in SKILL_FIELD_CONFIG" :key="field.name"
							><AccessFieldComponent
								v-if="field.name === 'tags' || field.name === 'examples'"
								:model-value="text(skill[field.name])"
								:name="'agent-skill-' + index + '-' + field.name"
								:label="field.label"
								:required="field.name === 'tags'"
								:placeholder="field.placeholder"
								:error="errors?.['skills.' + index + '.' + field.name]"
								@update:model-value="skill[field.name] = list($event, field.name === 'examples')" /><AccessFieldComponent
								v-else
								v-model="skill[field.name]"
								:name="'agent-skill-' + index + '-' + field.name"
								:label="field.label"
								required
								:type="field.name === 'description' ? 'textarea' : 'text'"
								:rows="2"
								:placeholder="field.placeholder"
								:error="errors?.['skills.' + index + '.' + field.name]" /></template
						><UiButton variant="link" class="tools-agent-remove" @click="removeSkill(index)"
							><UiIcon name="MinusCircleOutlined" />Remove Skill</UiButton
						>
					</section>
					<UiButton class="tools-agent-add-item" @click="addSkill"><UiIcon name="PlusOutlined" />Add Skill</UiButton>
				</div>
			</details>
			<details v-for="section in [AGENT_FORM_CONFIG.capabilities, AGENT_FORM_CONFIG.optional]" :key="section.key">
				<summary>{{ section.title }}</summary>
				<div>
					<AccessFieldComponent
						v-for="field in section.fields"
						:key="field.name"
						v-model="draft[field.name]"
						:name="'agent-' + field.name"
						:label="field.label"
						:type="field.type === 'switch' ? 'switch' : 'text'"
						:placeholder="field.placeholder"
					/>
				</div></details
		></template>
		<details>
			<summary>Cost Configuration</summary>
			<div>
				<AccessFieldComponent
					v-for="field in AGENT_FORM_CONFIG.cost.fields"
					:key="field.name"
					v-model="draft[field.name]"
					:name="'agent-' + field.name"
					:label="field.label"
					:placeholder="field.placeholder"
					:tooltip="field.tooltip"
				/>
			</div>
		</details>
		<template v-if="!dynamic"
			><details>
				<summary>LiteLLM Parameters</summary>
				<div>
					<AccessFieldComponent
						v-for="field in AGENT_FORM_CONFIG.litellm.fields"
						:key="field.name"
						v-model="draft[field.name]"
						:name="'agent-' + field.name"
						:label="field.label"
						:type="field.type === 'switch' ? 'switch' : 'text'"
					/>
				</div>
			</details>
			<details>
				<summary>Authentication Headers</summary>
				<div>
					<UiFormField label="Static Headers"
						><div v-for="(header, index) in headers" :key="index" class="tools-agent-static-header">
							<AccessFieldComponent
								v-model="header.header"
								:name="'agent-header-' + index"
								placeholder="Header name (e.g. Authorization)"
								:error="errors?.['static_headers.' + index + '.header']"
							/><AccessFieldComponent
								v-model="header.value"
								:name="'agent-header-value-' + index"
								placeholder="Value (e.g. Bearer token123)"
								:error="errors?.['static_headers.' + index + '.value']"
							/><button
								type="button"
								class="tools-agent-remove-header"
								aria-label="Remove static header"
								@click="removeHeader(index)"
							>
								<UiIcon name="MinusCircleOutlined" />
							</button>
						</div>
						<UiButton class="tools-agent-add-item" @click="addHeader"
							><UiIcon name="PlusOutlined" />Add Static Header</UiButton
						></UiFormField
					><AccessFieldComponent
						v-model="draft.extra_headers"
						name="agent-extra-headers"
						label="Forward Client Headers"
						tooltip="Header names to extract from the client's request and forward to the agent. Type a name and press Enter."
						type="select"
						multiple
						creatable
						placeholder="e.g. x-api-key, Authorization"
					/>
				</div></details
		></template>
	</div>
</template>
