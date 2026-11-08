<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { PlaygroundMcpServer } from "../../support/PlaygroundModels";
import { saveByokCredential } from "../../api/PlaygroundByokApi";
import { messageManager } from "../../../notifications/logic/MessageManager";
import UiDialog from "../../../platform/ui/UiDialog.vue";
import PlaygroundPasswordInputComponent from "./PlaygroundPasswordInputComponent.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiSwitch from "../../../platform/ui/UiSwitch.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
const props = defineProps<{ server: PlaygroundMcpServer | null }>(),
	emit = defineEmits<{ close: []; success: [] }>(),
	step = ref(1),
	key = ref(""),
	save = ref(true),
	loading = ref(false);
const name = computed(() => props.server?.alias || props.server?.server_name || "Service"),
	access = computed(() =>
		Array.isArray(props.server?.byok_description)
			? props.server.byok_description.filter((value): value is string => typeof value === "string")
			: [],
	);
watch(
	() => props.server,
	() => {
		step.value = 1;
		key.value = "";
		save.value = true;
		loading.value = false;
	},
);
async function connect() {
	if (!props.server || loading.value) return;
	if (!key.value.trim()) {
		messageManager.error("Please enter your API key");
		return;
	}
	loading.value = true;
	try {
		await saveByokCredential(props.server.server_id, key.value, save.value);
		messageManager.success("Connected to " + name.value);
		emit("success");
		emit("close");
	} catch (error) {
		messageManager.error(error instanceof Error && error.message ? error.message : "Failed to connect");
	} finally {
		loading.value = false;
	}
}
</script>
<template>
	<UiDialog
		:show-footer="false"
		:open="Boolean(server)"
		:width="480"
		:closable="false"
		scroll-mode="overlay"
		class="pg-byok-dialog"
		@update:open="!$event && emit('close')"
		><div class="pg-byok" :class="{ 'is-details': step === 2 }">
			<div class="pg-byok__top">
				<button v-if="step === 2" type="button" aria-label="Back" @click="step = 1"><UiIcon name="ArrowLeftOutlined" /> Back</button
				><span v-else></span>
				<div class="pg-byok__dots"><i :class="{ active: step === 1 }"></i><i :class="{ active: step === 2 }"></i></div>
				<button type="button" aria-label="Close" @click="emit('close')"><UiIcon name="CloseOutlined" /></button>
			</div>
			<template v-if="step === 1"
				><div class="pg-byok__logos">
					<span class="pg-byok__litellm">L</span><UiIcon name="ArrowRightOutlined" /><span class="pg-byok__service">{{
						name[0]?.toUpperCase()
					}}</span>
				</div>
				<h2>Connect {{ name }}</h2>
				<p class="pg-byok__subtitle">LiteLLM needs access to {{ name }} to complete your request.</p>
				<div class="pg-byok__card pg-byok__bridge">
					<div class="pg-byok__bridge-icon">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
							<rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" stroke-width="2" />
							<path d="M8 4v16M16 4v16" stroke="currentColor" stroke-width="2" />
						</svg>
					</div>
					<div>
						<strong>How it works</strong>
						<p>
							LiteLLM acts as a secure bridge. Your requests are routed through our MCP client directly to {{ name }}'s API.
						</p>
					</div>
				</div>
				<div v-if="access.length" class="pg-byok__card">
					<strong class="pg-byok__uppercase"
						><svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
							<path d="M12 2L12 22M2 12L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
							<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" /></svg
						>Requested Access</strong
					>
					<ul>
						<li v-for="item in access" :key="item"><UiIcon name="CheckOutlined" />{{ item }}</li>
					</ul>
				</div>
				<button type="button" class="pg-byok__continue" @click="step = 2">
					Continue to Authentication <UiIcon name="ArrowRightOutlined" /></button
				><button type="button" class="pg-byok__cancel" @click="emit('close')">Cancel</button></template
			><template v-else
				><div class="pg-byok__key"><UiIcon name="KeyOutlined" /></div>
				<h2>Provide API Key</h2>
				<p class="pg-byok__subtitle">Enter your {{ name }} API key to authorize this connection.</p>
				<label class="pg-field-label">{{ name }} API Key</label
				><PlaygroundPasswordInputComponent v-model="key" size="large" placeholder="Enter your API key" /><a
					v-if="typeof server?.byok_api_key_help_url === 'string'"
					:href="server.byok_api_key_help_url"
					target="_blank"
					rel="noopener noreferrer"
					class="pg-byok__help"
					>Where do I find my API key? <UiIcon name="LinkOutlined"
				/></a>
				<div class="pg-byok__save">
					<span
						><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
							<path
								d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"
								fill="currentColor"
							/></svg
						>Save key for future use</span
					><UiSwitch v-model="save" />
				</div>
				<div class="pg-byok__security">
					<UiIcon name="LockOutlined" /><span
						>Your key is stored securely and transmitted over HTTPS. It is never shared with third parties.</span
					>
				</div>
				<button type="button" class="pg-byok__connect" :disabled="loading" @click="connect">
					<UiSpinner v-if="loading" :size="16" /><UiIcon v-else name="LockOutlined" />Connect &amp; Authorize
				</button></template
			>
		</div></UiDialog
	>
</template>
