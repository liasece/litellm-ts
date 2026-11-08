<script setup lang="ts">
import { computed, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import CodeHighlightComponent from "../../content/ui/CodeHighlightComponent.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { WEB_UI_COOKIE_SESSION_SENTINEL } from "../../platform/api/HttpApiClient";
import { copyToolText } from "../../tools/support/ToolClipboardSupport";
import { notificationManager } from "../../notifications/logic/NotificationManager";
import { generatePromptCode } from "../logic/PromptCodeLogic";
const props = withDefaults(
	defineProps<{
		promptId: string;
		model: string;
		promptVariables?: Record<string, string>;
		version?: string;
		proxySettings?: { PROXY_BASE_URL?: string; LITELLM_UI_API_DOC_BASE_URL?: string | null };
	}>(),
	{ promptVariables: () => ({}), version: "1", proxySettings: undefined },
);
const auth = useAuthenticationStore(),
	open = ref(false),
	language = ref<"curl" | "python" | "javascript">("curl"),
	tab = ref("basic");
const base = computed(() =>
		props.proxySettings?.LITELLM_UI_API_DOC_BASE_URL?.trim()
			? props.proxySettings.LITELLM_UI_API_DOC_BASE_URL
			: props.proxySettings?.PROXY_BASE_URL || window.location.origin,
	),
	code = computed(() =>
		generatePromptCode({
			apiBase: base.value,
			effectiveApiKey: auth.isAuthorized.value ? WEB_UI_COOKIE_SESSION_SENTINEL : "sk-1234",
			model: props.model,
			promptId: props.promptId,
			promptVariables: props.promptVariables,
			version: props.version,
			selectedLanguage: language.value,
			selectedTab: tab.value,
		}),
	);
async function copy() {
	if (await copyToolText(code.value)) notificationManager.success("Copied to clipboard!");
}
function select(value: unknown) {
	if (value === "curl" || value === "python" || value === "javascript") language.value = value;
}
</script>
<template>
	<UiButton appearance="tremor" @click="open = true"
		><template #icon><UiIcon name="CodeOutlined" /></template>Get Code</UiButton
	><UiDialog v-model:open="open" title="Generated Code" :width="800" :show-footer="false" scroll-mode="overlay" class="prompt-code-dialog"
		><header>
			<label
				><span>Language</span
				><UiSelect
					:model-value="language"
					:options="[
						{ value: 'curl', label: 'cURL' },
						{ value: 'python', label: 'Python (OpenAI SDK)' },
						{ value: 'javascript', label: 'JavaScript (OpenAI SDK)' },
					]"
					@update:model-value="select" /></label
			><UiButton @click="copy">Copy to Clipboard</UiButton>
		</header>
		<UiTabs
			v-model="tab"
			:items="[
				{ key: 'basic', label: 'Basic' },
				{ key: 'messages', label: 'With Messages' },
				{ key: 'version', label: 'With Version' },
			]" /><CodeHighlightComponent
			:code="code"
			:language="language === 'curl' ? 'bash' : language"
			theme="coy"
			:token-style-overrides="{ parameter: { color: 'inherit', background: 'none' } }"
			wrap-long-lines
			:custom-style="{ maxHeight: '60vh', overflowY: 'auto', marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }"
	/></UiDialog>
</template>
