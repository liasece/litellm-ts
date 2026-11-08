<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { PlaygroundAgentBuilderStore } from "../../stores/PlaygroundAgentBuilderStore";
import { agentConnectBase, agentCurl } from "../../logic/PlaygroundAgentBuilderLogic";
import { getApiBaseUrl } from "../../../platform/api/HttpApiClient";
import { readText, browserSessionStorage } from "../../logic/PlaygroundStorageLogic";
import CodeHighlightComponent from "../../../content/ui/CodeHighlightComponent.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
const props = defineProps<{ store: PlaygroundAgentBuilderStore; disabled: boolean }>(),
	base = computed(() =>
		agentConnectBase(props.store.catalog.state.settings, getApiBaseUrl(), readText(browserSessionStorage(), "customProxyBaseUrl")),
	),
	code = computed(() => agentCurl(base.value, props.store.selected.value?.model_name ?? "", props.store.state.key)),
	copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
async function copy() {
	await navigator.clipboard.writeText(code.value);
	copied.value = true;
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => (copied.value = false), 2000);
}
onBeforeUnmount(() => {
	if (timer) clearTimeout(timer);
});
</script>
<template>
	<div class="pg-agent-connect">
		<div>
			<h3>Proxy base URL</h3>
			<p class="pg-agent-connect__base">{{ base }}</p>
		</div>
		<div>
			<h3>Call your agent (cURL)</h3>
			<div class="pg-agent-connect__code">
				<button type="button" aria-label="Copy code" @click="copy">
					<UiLucideIcon :name="copied ? 'CheckIcon' : 'ClipboardIcon'" :size="16" />
				</button>
				<CodeHighlightComponent
					:code="code"
					language="bash"
					theme="one-light"
					:token-style-overrides="{ parameter: { color: 'inherit' } }"
					show-line-numbers
					:custom-style="{ margin: 0, padding: '1.5rem', borderRadius: '0.5rem', fontSize: '0.9rem', backgroundColor: '#fafafa' }"
				/>
			</div>
		</div>
		<div class="pg-agent-connect__key">
			<h3>Create a key for this agent</h3>
			<p>
				Create a virtual key that can only call this agent. The key will be scoped to you (user_id) and restricted to the model
				<code>{{ store.selected.value?.model_name }}</code
				>.
			</p>
			<UiButton variant="primary" :loading="store.state.creatingKey" :disabled="disabled" @click="store.createKey"
				>Create key for this agent</UiButton
			><small v-if="disabled" class="is-warning">Key creation is disabled for your account.</small
			><small v-if="store.state.key" class="is-success"
				>Key created. It is shown in the cURL example above — copy the snippet to use it.</small
			>
		</div>
	</div>
</template>
