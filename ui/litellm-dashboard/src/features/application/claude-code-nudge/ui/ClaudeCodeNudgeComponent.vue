<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { useBrowserPreferences } from "../../stores/BrowserPreferencesStore";
import { createClaudeCodeNudgeStore } from "../stores/ClaudeCodeNudgeStore";
import ClaudeCodePromptComponent from "./ClaudeCodePromptComponent.vue";
import ClaudeCodeModalComponent from "./ClaudeCodeModalComponent.vue";
import "./ClaudeCodeNudgeStyles.css";
const auth = useAuthenticationStore(),
	preferences = useBrowserPreferences(),
	store = createClaudeCodeNudgeStore(() => preferences.setPreference("disableShowPrompts", true)),
	state = store.state;
watch([() => auth.isAuthorized.value, () => auth.state.session?.user_id], ([authorized]) => void store.initialize(authorized), {
	immediate: true,
});
onBeforeUnmount(store.dispose);
</script>
<template>
	<Teleport to="body"
		><ClaudeCodePromptComponent
			v-if="state.visible && (state.confirmation || !preferences.preferences.disableShowPrompts)"
			:confirmation="state.confirmation"
			:progress="state.progress"
			@open="store.open"
			@dismiss="store.dismiss"
			@dont-ask="store.dontAskAgain" /><ClaudeCodeModalComponent
			v-if="state.modalOpen"
			@close="store.close"
			@complete="store.complete"
	/></Teleport>
</template>
