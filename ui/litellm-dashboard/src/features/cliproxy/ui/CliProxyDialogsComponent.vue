<script setup lang="ts">
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import type { CliProxyStore } from "../stores/CliProxyStore";
import CliProxyPasswordInput from "./CliProxyPasswordInputComponent.vue";
import ProviderIdentityComponent from "../../providers/ui/ProviderIdentityComponent.vue";
const props = defineProps<{ store: CliProxyStore }>();
const state = props.store.state;
</script>
<template>
	<UiDialog
		:open="state.oauthSession !== null"
		:title="'OAuth login: ' + (state.oauthSession?.provider ?? '')"
		scroll-mode="overlay"
		:width="760"
		@update:open="!$event && (state.oauthSession = null)"
	>
		<template #title>
			<span class="cp-dialog-provider-title">
				<ProviderIdentityComponent v-if="state.oauthSession" :provider="state.oauthSession.provider" :tag="false" />
				<span>OAuth login</span>
			</span>
		</template>
		<UiTag :color="state.oauthSession?.state === 'succeeded' ? 'green' : state.oauthSession?.state === 'running' ? 'blue' : 'red'">{{
			state.oauthSession?.state
		}}</UiTag>
		<pre class="cp-terminal cp-oauth-output">{{ state.oauthSession?.output.join("\n") || "Waiting for login output..." }}</pre>
		<div v-if="state.oauthSession?.state === 'running'" class="cp-oauth-input">
			<UiInput v-model="state.oauthInput" placeholder="Input requested by the login flow (if any)" /><UiButton
				@click="store.sendOAuthInput"
				>Send</UiButton
			>
		</div>
		<template #footer><UiButton @click="state.oauthSession = null">Close</UiButton></template></UiDialog
	>
	<UiDialog
		:open="state.editingCommandCode !== null"
		title="Edit CommandCode account"
		class="cp-account-dialog"
		scroll-mode="overlay"
		@update:open="!$event && (state.editingCommandCode = null)"
		><div class="cp-stack cp-gap-16">
			<label class="cp-field"><span class="cp-secondary">Label</span><UiInput v-model="state.editingCommandCodeLabel" /></label
			><label class="cp-field"
				><span class="cp-secondary">New API key (leave blank to keep the current key)</span
				><CliProxyPasswordInput v-model="state.editingCommandCodeKey"
			/></label>
		</div>
		<template #footer
			><UiButton @click="state.editingCommandCode = null">Cancel</UiButton
			><UiButton variant="primary" :loading="state.busy === 'edit commandcode account'" @click="store.saveCommandCodeAccount"
				>Save</UiButton
			></template
		></UiDialog
	>
</template>
