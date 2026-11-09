<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { createPlaygroundChatStore } from "../../stores/PlaygroundChatStore";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
import PlaygroundConfigurationComponent from "./PlaygroundConfigurationComponent.vue";
import PlaygroundComposerComponent from "./PlaygroundComposerComponent.vue";
import PlaygroundMessageComponent from "./PlaygroundMessageComponent.vue";
import PlaygroundCodeDialogComponent from "./PlaygroundCodeDialogComponent.vue";
import PlaygroundRealtimeComponent from "./PlaygroundRealtimeComponent.vue";
import "./PlaygroundChatStyles.css";
import "./PlaygroundMessageStyles.css";
import "./PlaygroundComposerStyles.css";
import "./PlaygroundConfigurationStyles.css";
const auth = useAuthenticationStore(),
	disabled = computed(
		() =>
			Boolean(auth.state.session?.disabled_non_admin_personal_key_creation) &&
			!["Admin", "Admin Viewer"].includes(auth.userRole.value),
	);
const store = createPlaygroundChatStore({
		disabledPersonalKeyCreation: disabled.value,
		authenticated: () => auth.isAuthorized.value,
	}),
	end = ref<HTMLElement>(),
	codeOpen = ref(false);
watch(
	() => store.history.state.messages,
	async () => {
		await nextTick();
		end.value?.scrollIntoView({ behavior: "smooth", block: "end" });
	},
);
onMounted(() => void store.catalog.load());
onBeforeUnmount(store.dispose);
defineExpose({ store });
</script>
<template>
	<div class="pg-chat">
		<div class="pg-chat__card">
			<div class="pg-chat__layout">
				<PlaygroundConfigurationComponent :store="store" :disabled-personal-key-creation="disabled" />
				<main class="pg-chat__main">
					<PlaygroundRealtimeComponent
						v-if="store.settings.state.endpoint === 'realtime'"
						:auth="store.settings.auth()"
						:model="store.settings.state.selectedModel"
						:base-url="store.settings.state.customBaseUrl"
					/><template v-else
						><header class="pg-chat__header">
							<h2>Test Key</h2>
							<div>
								<UiButton appearance="tremor" variant="default" class="pg-chat__action" @click="store.clear()"
									><template #icon><UiIcon name="ClearOutlined" /></template>Clear Chat</UiButton
								><UiButton appearance="tremor" variant="default" class="pg-chat__action" @click="codeOpen = true"
									><template #icon><UiIcon name="CodeOutlined" /></template>Get Code</UiButton
								>
							</div>
						</header>
						<div class="pg-chat__messages">
							<div v-if="!store.history.state.messages.length" class="pg-chat__empty">
								<UiIcon name="RobotOutlined" />
								<p>Start a conversation, generate an image, or handle audio</p>
							</div>
							<PlaygroundMessageComponent
								v-for="(message, index) in store.history.state.messages"
								:key="message.id"
								:message="message"
								:last="index === store.history.state.messages.length - 1"
								:endpoint="store.settings.state.endpoint"
								:code-result="store.settings.state.codeResult"
							/>
							<div v-if="store.state.loading" class="pg-chat__loading"><UiSpinner /></div>
							<div ref="end"></div>
						</div>
						<PlaygroundComposerComponent :store="store"
					/></template>
				</main>
			</div>
		</div>
		<PlaygroundCodeDialogComponent v-model:open="codeOpen" :store="store" />
	</div>
</template>
