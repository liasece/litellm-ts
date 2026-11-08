<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import UiFormField from "../../platform/ui/UiFormField.vue";
import McpToolResultComponent from "./McpToolResultComponent.vue";
import { mcpToolSchema, mcpInitialArguments, mcpArgumentErrors, mcpToolArguments } from "../logic/McpToolSchemaLogic";
import { copyToolText } from "../support/ToolClipboardSupport";
import { notificationManager } from "../../notifications/logic/NotificationManager";
import type { createMcpToolRunnerStore } from "../stores/McpToolRunnerStore";
import type { MCPTool } from "../support/McpModels";
const props = defineProps<{ tool: MCPTool; runner: ReturnType<typeof createMcpToolRunnerStore> }>();
const emit = defineEmits<{ close: [] }>();
const values = ref<Record<string, unknown>>({}),
	errors = ref<Record<string, string>>({}),
	schema = computed(() => mcpToolSchema(props.tool).schema);
watch(
	() => props.tool,
	() => {
		values.value = mcpInitialArguments(schema.value);
		errors.value = {};
	},
	{ immediate: true },
);
async function submit() {
	errors.value = mcpArgumentErrors(schema.value, values.value);
	if (typeof props.tool.inputSchema === "string" && errors.value.input) errors.value.input = "Please enter input for this tool";
	if (!Object.keys(errors.value).length) await props.runner.call(mcpToolArguments(props.tool, values.value));
}
async function copyName() {
	if (await copyToolText(props.tool.name)) notificationManager.success("Tool name copied to clipboard");
	else notificationManager.fromBackend("Failed to copy tool name");
}
function text(value: unknown) {
	return typeof value === "string" || typeof value === "number" ? value : null;
}
</script>
<template>
	<div class="tools-mcp-test-panel">
		<header>
			<div>
				<img v-if="tool.mcp_info?.logo_url" :src="tool.mcp_info.logo_url" :alt="tool.mcp_info.server_name + ' logo'" />
				<section>
					<div>
						<h2>Test Tool:</h2>
						<button type="button" title="Click to copy tool name" class="tools-mcp-tool-name" @click="copyName">
							{{ tool.name }}<UiLucideIcon name="Copy" :size="12" />
						</button>
					</div>
					<p>{{ tool.description }}</p>
					<small>Provider: {{ tool.mcp_info?.server_name }}</small>
				</section>
			</div>
			<UiButton appearance="tremor" variant="text" size="small" aria-label="Close tool" @click="emit('close')"
				><UiLucideIcon name="X" :size="16"
			/></UiButton>
		</header>
		<div class="tools-mcp-test-columns">
			<section class="tools-mcp-arguments">
				<header>
					<h3>Input Parameters</h3>
					<UiTooltip title="Configure the input parameters for this tool call"><UiIcon name="InfoCircleOutlined" /></UiTooltip>
				</header>
				<form @submit.prevent="submit">
					<div v-if="schema.properties === undefined" class="tools-mcp-no-parameters">
						<strong>No Parameters Required</strong>
						<p>This tool can be called without any input parameters.</p>
					</div>
					<UiFormField
						v-for="(prop, key) in schema.properties"
						:key="key"
						:label="String(key)"
						:error="errors[key]"
						class="tools-mcp-argument-field"
						><template #label
							><span v-if="schema.required?.includes(String(key))" class="tools-mcp-required-mark">*</span
							>{{ typeof tool.inputSchema === "string" ? "Input" : key
							}}<span v-if="schema.required?.includes(String(key))" class="tools-mcp-required">*</span
							><UiTooltip v-if="prop.description" :title="prop.description"
								><UiIcon name="InfoCircleOutlined" /></UiTooltip></template
						><select
							v-if="prop.type === 'boolean' || (prop.type === 'string' && prop.enum)"
							:value="String(values[key] ?? '')"
							@change="values[key] = ($event.target as HTMLSelectElement).value"
						>
							<option v-if="!schema.required?.includes(String(key))" value="">Select {{ key }}</option>
							<option v-if="prop.type === 'boolean'" value="true">True</option>
							<option v-if="prop.type === 'boolean'" value="false">False</option>
							<template v-else>
								<option v-for="option in prop.enum" :key="option" :value="option">{{ option }}</option></template
							></select
						><textarea
							v-else-if="prop.type === 'object' || prop.type === 'array'"
							:value="String(values[key] ?? '')"
							:rows="prop.type === 'object' ? 6 : 4"
							:placeholder="
								prop.description ||
								(prop.type === 'object' ? 'Enter JSON object for ' + key : 'Enter JSON array for ' + key)
							"
							@input="values[key] = ($event.target as HTMLTextAreaElement).value"
						/><input
							v-else-if="prop.type === 'number' || prop.type === 'integer'"
							type="number"
							:value="text(values[key])"
							:step="prop.type === 'integer' ? 1 : 'any'"
							:placeholder="prop.description || 'Enter ' + key"
							@input="values[key] = ($event.target as HTMLInputElement).value"
						/><UiInput
							v-else
							:model-value="text(values[key])"
							appearance="tremor"
							:placeholder="
								typeof tool.inputSchema === 'string' ? 'Enter input for this tool' : prop.description || 'Enter ' + key
							"
							@update:model-value="values[key] = $event"
						/><small v-if="prop.type === 'object' || prop.type === 'array'"
							>Provide a valid JSON {{ prop.type }}.</small
						></UiFormField
					>
					<div class="tools-mcp-call-footer">
						<UiButton type="submit" appearance="tremor" variant="primary" :loading="runner.calling.value">{{
							runner.calling.value
								? "Calling Tool..."
								: runner.result.value || runner.callError.value
									? "Call Again"
									: "Call Tool"
						}}</UiButton>
					</div>
				</form>
			</section>
			<McpToolResultComponent
				:result="runner.result.value"
				:error="runner.callError.value"
				:loading="runner.calling.value"
				:duration="runner.duration.value"
			/>
		</div>
	</div>
</template>
