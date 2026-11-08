<script setup lang="ts">
import { computed, watch } from "vue";
import type { PlaygroundChatStore } from "../../stores/PlaygroundChatStore";
import type { EndpointType } from "../../support/PlaygroundModels";
import { endpointOptions, voiceOptions, modelOptions } from "../../data/PlaygroundEndpointData";
import { policyOptions, vectorOptions, tagOptions, guardrailOptions } from "../../logic/PlaygroundOptionsLogic";
import type { UiValue } from "../../../platform/ui/UiTypes";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiPopover from "../../../platform/ui/UiPopover.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiSwitch from "../../../platform/ui/UiSwitch.vue";
import PlaygroundAdvancedParametersComponent from "./PlaygroundAdvancedParametersComponent.vue";
import PlaygroundSessionManagementComponent from "./PlaygroundSessionManagementComponent.vue";
const props = withDefaults(defineProps<{ store: PlaygroundChatStore; disabledPersonalKeyCreation?: boolean }>(), {
	disabledPersonalKeyCreation: false,
});
const storeState = props.store.state;
const settings = props.store.settings,
	config = settings.state,
	catalog = props.store.catalog,
	history = props.store.history;
const models = computed(() => [{ value: "custom", label: "Enter custom model" }, ...modelOptions(catalog.state.models, config.endpoint)]);
const isChatModel = computed(() => {
	const model = catalog.state.models.find((model) => model.model_group === config.selectedModel);
	return Boolean(model && (!model.mode || model.mode === "chat"));
});
const mcpSupported = computed(() => ["chat", "responses", "mcp"].includes(config.endpoint));
const openAiModel = computed(() => {
	const model = config.selectedModel.toLowerCase();
	return (
		model.startsWith("openai/") ||
		model.startsWith("gpt-") ||
		model.startsWith("o1") ||
		model.startsWith("o3") ||
		model.includes("openai")
	);
});
const servers = computed(() => [
	...(config.endpoint !== "mcp" ? [{ value: "__all__", label: "All MCP Servers" }] : []),
	...catalog.state.servers.map((server) => ({ value: server.server_id, label: server.alias || server.server_name || server.server_id })),
]);
const tools = computed(() => catalog.state.tools[config.mcpServers[0]] ?? []);
function array(value: UiValue | UiValue[] | null) {
	return value === null ? [] : (Array.isArray(value) ? value : [value]).map(String);
}
function endpoint(value: UiValue | UiValue[] | null) {
	if (typeof value === "string" && endpointOptions.some((option) => option.value === value))
		settings.selectEndpoint(value as EndpointType);
}
function source(value: UiValue | UiValue[] | null) {
	if (value === "session" || value === "custom") config.apiKeySource = value;
}
function chooseServers(value: UiValue | UiValue[] | null) {
	settings.selectServers(array(value));
	for (const id of config.mcpServers) if (id !== "__all__" && !catalog.state.tools[id]) void catalog.loadTools(id);
}
watch(
	[() => config.endpoint, () => config.apiKeySource, () => config.apiKey, () => config.customBaseUrl],
	() => {
		if (config.endpoint === "a2a_agents" && settings.hasAuth())
			void catalog.loadAgents(settings.auth(), config.customBaseUrl || undefined);
	},
	{ immediate: true },
);
</script>
<template>
	<aside class="pg-configuration">
		<h2>Configurations</h2>
		<div class="pg-configuration__fields">
			<div>
				<label class="pg-field-label"><UiIcon name="KeyOutlined" /> Virtual Key Source</label
				><UiSelect
					:model-value="config.apiKeySource"
					aria-label="Virtual Key Source"
					:options="[
						{ value: 'session', label: 'Current UI Session' },
						{ value: 'custom', label: 'Virtual Key' },
					]"
					:disabled="disabledPersonalKeyCreation"
					@update:model-value="source"
				/><UiInput
					v-if="config.apiKeySource === 'custom'"
					v-model="config.apiKey"
					appearance="tremor"
					type="password"
					placeholder="Enter custom Virtual Key"
					class="pg-mt-8"
					><template #prefix><UiIcon name="KeyOutlined" /></template
				></UiInput>
			</div>
			<div>
				<div class="pg-between pg-mb-8">
					<label class="pg-field-label pg-field-label--inline"><UiIcon name="SettingOutlined" /> Custom Proxy Base URL</label
					><UiButton
						v-if="catalog.state.settings.LITELLM_UI_API_DOC_BASE_URL && !config.customBaseUrl"
						variant="link"
						size="small"
						@click="config.customBaseUrl = String(catalog.state.settings.LITELLM_UI_API_DOC_BASE_URL)"
						><template #icon><UiIcon name="LinkOutlined" /></template>Fill</UiButton
					><UiButton v-if="config.customBaseUrl" variant="link" size="small" @click="config.customBaseUrl = ''"
						><template #icon><UiIcon name="ClearOutlined" /></template>Clear</UiButton
					>
				</div>
				<UiInput
					v-model="config.customBaseUrl"
					appearance="tremor"
					placeholder="Optional: Enter custom proxy URL (e.g., http://localhost:5000)"
					><template #prefix><UiIcon name="ApiOutlined" /></template
				></UiInput>
				<p v-if="config.customBaseUrl" class="pg-hint">API calls will be sent to: {{ config.customBaseUrl }}</p>
			</div>
			<div>
				<label class="pg-field-label"><UiIcon name="ApiOutlined" /> Endpoint Type</label
				><UiSelect
					:model-value="config.endpoint"
					aria-label="Endpoint Type"
					:options="endpointOptions"
					searchable
					@update:model-value="endpoint"
				/>
				<div v-if="config.endpoint === 'speech'" class="pg-mt-16">
					<label class="pg-field-label"><UiIcon name="SoundOutlined" /> Voice</label
					><UiSelect
						:model-value="config.voice"
						:options="voiceOptions"
						@update:model-value="config.voice = String($event || 'alloy')"
					/>
				</div>
				<PlaygroundSessionManagementComponent v-if="config.endpoint === 'responses'" :history="history" />
			</div>
			<div v-if="config.endpoint !== 'a2a_agents' && config.endpoint !== 'mcp'">
				<div class="pg-between pg-mb-8">
					<label class="pg-field-label pg-field-label--inline"><UiIcon name="RobotOutlined" /> Select Model</label
					><UiPopover v-if="isChatModel" trigger="click" placement="right"
						><UiButton
							variant="text"
							size="small"
							aria-label="Model Settings"
							data-testid="model-settings-button"
							class="pg-config-gear"
							><UiIcon name="SettingOutlined" /></UiButton
						><template #content
							><strong class="pg-popover-title">Model Settings</strong
							><PlaygroundAdvancedParametersComponent :settings="settings" /></template></UiPopover
					><UiTooltip v-else title="Advanced parameters are only supported for chat models currently"
						><UiButton variant="text" size="small" disabled><UiIcon name="SettingOutlined" /></UiButton
					></UiTooltip>
				</div>
				<UiSelect
					:model-value="config.selectedModel || null"
					aria-label="Select Model"
					placeholder="Select a Model"
					:options="models"
					searchable
					@update:model-value="settings.selectModel(String($event || ''))"
				/><UiInput
					v-if="config.customModel"
					:model-value="config.customModelName"
					appearance="tremor"
					placeholder="Enter custom model name"
					class="pg-mt-8"
					@update:model-value="settings.customModel(String($event || ''))"
				/>
			</div>
			<div v-if="config.endpoint === 'a2a_agents'">
				<label class="pg-field-label"><UiIcon name="RobotOutlined" /> Select Agent</label
				><UiSelect
					:model-value="config.selectedAgent || null"
					aria-label="Select Agent"
					placeholder="Select an Agent"
					searchable
					:options="catalog.state.agents.map((agent) => ({ value: agent.agent_name, label: agent.agent_name || agent.agent_id }))"
					@update:model-value="config.selectedAgent = String($event || '')"
				/>
				<p v-if="!catalog.state.agents.length" class="pg-hint">No agents found. Create agents via /v1/agents endpoint.</p>
			</div>
			<div class="pg-config-tags">
				<label class="pg-field-label"><UiIcon name="TagsOutlined" /> Tags</label
				><UiSelect
					:model-value="config.tags"
					max-tag-count="responsive"
					aria-label="Tags"
					:options="tagOptions(catalog.state.tags)"
					multiple
					searchable
					creatable
					clearable
					:token-separators="[',']"
					placeholder="Select or create tags"
					@update:model-value="config.tags = array($event)"
				/>
			</div>
			<div class="pg-config-mcp">
				<label class="pg-field-label"
					><UiIcon name="ToolOutlined" /> {{ config.endpoint === "mcp" ? "MCP Server" : "MCP Servers" }}
					<UiTooltip
						:title="
							config.endpoint === 'mcp'
								? 'Select an MCP server to test tools directly.'
								: 'Select MCP servers to use in your conversation.'
						"
						><UiIcon name="InfoCircleOutlined" /></UiTooltip
				></label>
				<div class="pg-config-mcp__select">
					<UiSelect
						:model-value="config.endpoint === 'mcp' ? config.mcpServers[0] || null : config.mcpServers"
						aria-label="MCP Servers"
						:max-tag-count="config.endpoint === 'mcp' ? 1 : 'responsive'"
						:multiple="config.endpoint !== 'mcp'"
						:options="servers"
						:disabled="!mcpSupported"
						:loading="catalog.state.loading"
						searchable
						clearable
						:placeholder="config.endpoint === 'mcp' ? 'Select MCP server' : 'Select MCP servers'"
						@update:model-value="chooseServers"
					/>
				</div>
				<div
					v-if="config.endpoint === 'mcp' && config.mcpServers.length === 1 && config.mcpServers[0] !== '__all__'"
					class="pg-mt-12"
				>
					<label class="pg-small-label">Select Tool</label
					><UiSelect
						:model-value="config.directTool || null"
						aria-label="Select Tool"
						:options="tools.map((tool) => ({ value: tool.name, label: tool.name }))"
						placeholder="Select a tool to call"
						clearable
						@update:model-value="config.directTool = String($event || '')"
					/>
				</div>
				<div
					v-if="config.mcpServers.length && !config.mcpServers.includes('__all__') && config.endpoint !== 'mcp' && mcpSupported"
					class="pg-tool-restrictions"
				>
					<template v-for="id in config.mcpServers" :key="id"
						><div v-if="catalog.state.tools[id]?.length">
							<label class="pg-small-label"
								>Limit tools for
								{{
									catalog.state.servers.find((server) => server.server_id === id)?.alias ||
									catalog.state.servers.find((server) => server.server_id === id)?.server_name ||
									id
								}}:</label
							><UiSelect
								:model-value="config.mcpRestrictions[id] || []"
								:max-tag-count="2"
								:options="catalog.state.tools[id].map((tool) => ({ value: tool.name, label: tool.name }))"
								size="small"
								multiple
								placeholder="All tools (default)"
								@update:model-value="settings.restrictTools(id, array($event))"
							/></div
					></template>
				</div>
				<div v-if="config.mcpServers.length && !config.mcpServers.includes('__all__')" class="pg-byok-statuses">
					<template v-for="id in config.mcpServers" :key="id"
						><div v-if="catalog.state.servers.find((server) => server.server_id === id)?.is_byok" class="pg-byok-status">
							<span
								>{{
									catalog.state.servers.find((server) => server.server_id === id)?.alias ||
									catalog.state.servers.find((server) => server.server_id === id)?.server_name ||
									id
								}}
								requires your API key</span
							><span
								v-if="catalog.state.servers.find((server) => server.server_id === id)?.has_user_credential"
								class="pg-inline"
								><strong><UiIcon name="KeyOutlined" /> Connected</strong
								><button type="button" @click="storeState.byokServer = id">Reconnect</button></span
							><button v-else type="button" class="pg-byok-connect" @click="storeState.byokServer = id">Connect</button>
						</div></template
					>
				</div>
			</div>
			<div class="pg-config-spaced">
				<label class="pg-field-label"
					><UiIcon name="DatabaseOutlined" /> Vector Store
					<UiTooltip title="Select vector store(s) to use for this LLM API call. You can set up your vector store here."
						><UiIcon name="InfoCircleOutlined" /></UiTooltip></label
				><UiSelect
					:model-value="config.vectors"
					aria-label="Vector Store"
					:options="vectorOptions(catalog.state.vectors)"
					multiple
					searchable
					clearable
					placeholder="Select vector stores"
					@update:model-value="config.vectors = array($event)"
				/>
			</div>
			<div class="pg-config-spaced">
				<label class="pg-field-label"
					><UiIcon name="SafetyOutlined" /> Guardrails
					<UiTooltip title="Select guardrail(s) to use for this LLM API call. You can set up your guardrails here."
						><UiIcon name="InfoCircleOutlined" /></UiTooltip></label
				><UiSelect
					:model-value="config.guardrails"
					aria-label="Guardrails"
					:options="guardrailOptions(catalog.state.guardrails)"
					multiple
					searchable
					clearable
					placeholder="Select guardrails"
					@update:model-value="config.guardrails = array($event)"
				/>
			</div>
			<div class="pg-config-spaced">
				<label class="pg-field-label"
					><UiIcon name="SafetyOutlined" /> Policies
					<UiTooltip
						content="Select policy/policies to apply to this LLM API call. Policies define which guardrails are applied based on conditions."
						><UiIcon name="InfoCircleOutlined" /></UiTooltip></label
				><UiSelect
					:model-value="config.policies"
					aria-label="Policies"
					:options="policyOptions(catalog.state.policies)"
					multiple
					searchable
					clearable
					placeholder="Select policies (production or published versions)"
					@update:model-value="config.policies = array($event)"
				/>
			</div>
			<div v-if="config.endpoint === 'responses'" class="pg-code-tool">
				<div class="pg-between">
					<span class="pg-inline"
						><UiIcon name="CodeOutlined" /><strong>Code Interpreter</strong
						><UiTooltip
							content="Run Python code to generate files, charts, and analyze data. Container is created automatically."
							><UiIcon name="InfoCircleOutlined" /></UiTooltip></span
					><UiSwitch
						:model-value="config.codeEnabled && openAiModel"
						:disabled="!openAiModel"
						size="small"
						@update:model-value="config.codeEnabled = $event"
					/>
				</div>
				<div v-if="!openAiModel" class="pg-code-tool__unavailable">
					<UiIcon name="ExclamationCircleOutlined" /><span
						>Code Interpreter is currently only supported for OpenAI models.
						<a
							href="https://github.com/BerriAI/litellm/issues/new?template=feature_request.yml"
							target="_blank"
							rel="noopener noreferrer"
							>Request support for other providers</a
						></span
					>
				</div>
			</div>
		</div>
	</aside>
</template>
