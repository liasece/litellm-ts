<script setup lang="ts">
import { computed, ref } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import ToolPasswordInputComponent from "./ToolPasswordInputComponent.vue";
import { mcpApi } from "../api/McpServersApi";
import messageManager from "../../notifications/logic/MessageManager";
import type { MCPServer } from "../support/McpModels";
import "../styles/McpByokStyles.css";
const props = defineProps<{ server: MCPServer }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ connected: [] }>();
const step = ref(1),
	key = ref(""),
	save = ref(true),
	pending = ref(false),
	name = computed(() => props.server.alias || props.server.server_name || "Service");
async function connect() {
	if (!key.value.trim()) {
		messageManager.error("Please enter your API key");
		return;
	}
	pending.value = true;
	try {
		await mcpApi.saveUserCredential(props.server.server_id, key.value.trim(), save.value);
		messageManager.success("Connected to " + name.value);
		emit("connected");
		open.value = false;
	} catch (reason) {
		messageManager.error(reason instanceof Error ? reason.message : "Failed to save API key");
	} finally {
		pending.value = false;
	}
}
</script>
<template>
	<UiDialog scroll-mode="overlay" v-model:open="open" :width="480" :show-footer="false" :closable="false" class="tools-mcp-byok"
		><div class="tools-mcp-byok-top">
			<button v-if="step === 2" type="button" aria-label="Back" @click="step = 1"><UiIcon name="ArrowLeftOutlined" /> Back</button
			><span v-else />
			<div><i :class="{ active: step === 1 }" /><i :class="{ active: step === 2 }" /></div>
			<button type="button" aria-label="Close" @click="open = false"><UiIcon name="CloseOutlined" /></button>
		</div>
		<template v-if="step === 1"
			><div class="tools-mcp-byok-brand">
				<div>L</div>
				<UiIcon name="ArrowRightOutlined" />
				<div>{{ name.charAt(0).toUpperCase() }}</div>
			</div>
			<h2>Connect {{ name }}</h2>
			<p>LiteLLM needs access to {{ name }} to complete your request.</p>
			<section>
				<div class="tools-mcp-byok-info">
					<div class="tools-mcp-byok-info-icon">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
							<rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" stroke-width="2" />
							<path d="M8 4v16M16 4v16" stroke="currentColor" stroke-width="2" />
						</svg>
					</div>
					<div>
						<h3>How it works</h3>
						<p>
							LiteLLM acts as a secure bridge. Your requests are routed through our MCP client directly to {{ name }}&apos;s
							API.
						</p>
					</div>
				</div>
			</section>
			<div v-if="server.byok_description?.length" class="tools-mcp-byok-permissions">
				<h3>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
						<path d="M12 2L12 22M2 12L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
						<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" />
					</svg>
					Requested Access
				</h3>
				<p v-for="description in server.byok_description" :key="description"><UiIcon name="CheckOutlined" />{{ description }}</p>
			</div>
			<UiButton variant="primary" class="tools-mcp-byok-continue" @click="step = 2"
				>Continue to Authentication<UiIcon name="ArrowRightOutlined" /></UiButton
			><button type="button" class="tools-mcp-byok-cancel" @click="open = false">Cancel</button></template
		><template v-else
			><div class="tools-mcp-byok-key-icon"><UiIcon name="KeyOutlined" :size="20" /></div>
			<h2>Provide API Key</h2>
			<p>Enter your {{ name }} API key to authorize this connection.</p>
			<form @submit.prevent="connect">
				<label>{{ name }} API Key</label
				><ToolPasswordInputComponent v-model="key" placeholder="Enter your API key" size="large" /><a
					v-if="server.byok_api_key_help_url"
					:href="server.byok_api_key_help_url"
					target="_blank"
					rel="noopener noreferrer"
					>Where do I find my API key? <UiIcon name="LinkOutlined"
				/></a>
				<div class="tools-mcp-byok-save">
					<div class="tools-mcp-byok-save-label">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
							<path
								d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"
								fill="currentColor"
							/>
						</svg>
						<strong>Save key for future use</strong>
					</div>
					<UiSwitch v-model="save" />
				</div>
				<aside>
					<UiIcon name="LockOutlined" /><span
						>Your key is stored securely and transmitted over HTTPS. It is never shared with third parties.</span
					>
				</aside>
				<UiButton type="submit" variant="primary" :loading="pending"
					><UiIcon name="LockOutlined" />Connect &amp; Authorize</UiButton
				>
			</form></template
		></UiDialog
	>
</template>
