<script setup lang="ts">
import { computed } from "vue";
import type { PlaygroundChatStore } from "../../stores/PlaygroundChatStore";
import type { EndpointType } from "../../support/PlaygroundModels";
import { endpointOptions, voiceOptions, modelOptions } from "../../data/PlaygroundEndpointData";
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
const settings = props.store.settings,
	config = settings.state,
	catalog = props.store.catalog,
	history = props.store.history;
const models = computed(() => [{ value: "custom", label: "Enter custom model" }, ...modelOptions(catalog.state.models, config.endpoint)]);
const isChatModel = computed(() => {
	const model = catalog.state.models.find((model) => model.model_group === config.selectedModel);
	return Boolean(model && (!model.mode || model.mode === "chat"));
});
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
			<div>
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
			<div class="pg-config-tags">
				<label class="pg-field-label"><UiIcon name="TagsOutlined" /> Tags</label
				><UiSelect
					:model-value="config.tags"
					max-tag-count="responsive"
					aria-label="Tags"
					:options="[]"
					multiple
					searchable
					creatable
					clearable
					:token-separators="[',']"
					placeholder="Select or create tags"
					@update:model-value="config.tags = array($event)"
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
