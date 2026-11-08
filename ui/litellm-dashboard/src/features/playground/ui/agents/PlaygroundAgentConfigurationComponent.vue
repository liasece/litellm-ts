<script setup lang="ts">
import type { PlaygroundAgentBuilderStore } from "../../stores/PlaygroundAgentBuilderStore";
import { modelOptions } from "../../data/PlaygroundEndpointData";
import type { UiValue } from "../../../platform/ui/UiTypes";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
const props = defineProps<{ store: PlaygroundAgentBuilderStore }>(),
	state = props.store.state;
function array(value: UiValue | UiValue[] | null) {
	return value === null ? [] : (Array.isArray(value) ? value : [value]).map(String);
}
</script>
<template>
	<div class="pg-agent-config">
		<div v-if="store.selected.value && !store.id.value" class="pg-agent-config__warning">
			This agent cannot be updated or deleted here (missing model id). Manage it from Models &amp; Endpoints.
		</div>
		<label>Agent name<UiInput v-model="state.name" placeholder="My Agent" /></label
		><label
			>System prompt<UiInput v-model="state.systemPrompt" multiline :rows="6" placeholder="You are a helpful assistant..." /></label
		><label
			>Underlying LLM<UiSelect
				:model-value="state.model || null"
				:options="modelOptions(store.catalog.state.models)"
				placeholder="Select model"
				@update:model-value="state.model = String($event || '')"
		/></label>
		<div class="pg-agent-config__parameters">
			<label
				>Temperature<UiInput
					:model-value="state.temperature"
					type="number"
					min="0"
					max="2"
					step=".1"
					@update:model-value="state.temperature = Number($event)" /></label
			><label
				>Max tokens<UiInput
					:model-value="state.maxTokens"
					type="number"
					min="1"
					@update:model-value="state.maxTokens = Number($event)"
			/></label>
		</div>
		<label
			>MCP servers<UiSelect
				:model-value="store.servers.value"
				:options="
					store.catalog.state.servers.map((server) => ({
						value: server.server_id,
						label: server.alias || server.server_name || server.server_id,
					}))
				"
				multiple
				searchable
				clearable
				:loading="store.catalog.state.loading"
				placeholder="Select MCP servers to attach (same format as chat completions API)"
				@update:model-value="store.chooseServers(array($event))"
			/><small v-if="store.selected.value && state.tools.length"
				>{{ state.tools.length }} MCP server{{ state.tools.length !== 1 ? "s" : "" }} saved. Use the same <code>tools</code> array
				in chat completions when calling this agent.</small
			></label
		>
		<div v-if="store.selected.value" class="pg-agent-config__actions">
			<template v-if="store.id.value"
				><UiButton variant="primary" :loading="state.saving" :disabled="!state.name.trim() || !state.model" @click="store.save"
					><template #icon><UiIcon name="SaveOutlined" /></template>Update Agent</UiButton
				><UiButton variant="danger" :loading="state.deleting" @click="state.confirmDelete = true"
					><template #icon><UiIcon name="DeleteOutlined" /></template>Delete</UiButton
				></template
			><UiButton variant="primary" @click="state.tab = 'chat'"
				><template #icon><UiIcon name="CommentOutlined" /></template>Test in Chat</UiButton
			>
		</div>
	</div>
</template>
