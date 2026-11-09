<script setup lang="ts">
import { computed, ref } from "vue";
import type { PlaygroundChatStore } from "../../stores/PlaygroundChatStore";
import { generateCodeSnippet } from "../../logic/PlaygroundCodeLogic";
import { notify } from "../../logic/PlaygroundValueLogic";
import CodeHighlightComponent from "../../../content/ui/CodeHighlightComponent.vue";
import UiDialog from "../../../platform/ui/UiDialog.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
const props = defineProps<{ open: boolean; store: PlaygroundChatStore }>(),
	emit = defineEmits<{ "update:open": [boolean] }>(),
	sdk = ref<"openai" | "azure">("openai"),
	config = props.store.settings.state;
const code = computed(() =>
	generateCodeSnippet({
		apiKeySource: config.apiKeySource,
		accessToken: "cookie-session",
		apiKey: config.apiKey,
		inputMessage: props.store.state.input,
		chatHistory: props.store.history.state.messages,
		selectedTags: config.tags,
		selectedVoice: config.voice,
		endpointType: config.endpoint,
		selectedModel: config.selectedModel,
		selectedSdk: sdk.value,
		proxySettings: props.store.catalog.state.settings,
	}),
);
async function copy() {
	await navigator.clipboard.writeText(code.value);
	notify("success", "Copied to clipboard!");
}
</script>
<template>
	<UiDialog
		:show-footer="false"
		:open="open"
		title="Generated Code"
		:width="800"
		scroll-mode="overlay"
		class="pg-code-dialog"
		@update:open="emit('update:open', $event)"
		><div class="pg-between pg-code-dialog__toolbar">
			<div>
				<label>SDK Type</label
				><UiSelect
					:model-value="sdk"
					:options="[
						{ value: 'openai', label: 'OpenAI SDK' },
						{ value: 'azure', label: 'Azure SDK' },
					]"
					style="width: 150px"
					@update:model-value="sdk = $event === 'azure' ? 'azure' : 'openai'"
				/>
			</div>
			<UiButton @click="copy">Copy to Clipboard</UiButton>
		</div>
		<CodeHighlightComponent
			:code="code"
			language="python"
			wrap-long-lines
			:custom-style="{ maxHeight: '60vh', overflowY: 'auto', borderRadius: '6px' }"
		/>
	</UiDialog>
</template>
