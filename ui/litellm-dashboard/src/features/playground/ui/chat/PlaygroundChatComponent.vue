<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { PlaygroundAuth } from "../../support/PlaygroundModels";
import { createPlaygroundChatStore } from "../../stores/PlaygroundChatStore";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
import PlaygroundConfigurationComponent from "./PlaygroundConfigurationComponent.vue";
import PlaygroundComposerComponent from "./PlaygroundComposerComponent.vue";
import PlaygroundMessageComponent from "./PlaygroundMessageComponent.vue";
import PlaygroundMcpEventsComponent from "./PlaygroundMcpEventsComponent.vue";
import PlaygroundCodeDialogComponent from "./PlaygroundCodeDialogComponent.vue";
import PlaygroundByokDialogComponent from "./PlaygroundByokDialogComponent.vue";
import PlaygroundRealtimeComponent from "./PlaygroundRealtimeComponent.vue";
import "./PlaygroundChatStyles.css";
import "./PlaygroundMessageStyles.css";
import "./PlaygroundComposerStyles.css";
import "./PlaygroundConfigurationStyles.css";
import "./PlaygroundByokStyles.css";
const props = withDefaults(defineProps<{ simplified?: boolean; fixedModel?: string; inferenceAuth?: PlaygroundAuth }>(), {
		simplified: false,
		fixedModel: undefined,
		inferenceAuth: undefined,
	}),
	auth = useAuthenticationStore(),
	disabled = computed(
		() =>
			Boolean(auth.state.session?.disabled_non_admin_personal_key_creation) &&
			!["Admin", "Admin Viewer"].includes(auth.userRole.value),
	);
const store = createPlaygroundChatStore({
		simplified: props.simplified,
		fixedModel: props.fixedModel,
		disabledPersonalKeyCreation: disabled.value,
		inferenceAuth: () => props.inferenceAuth,
		authenticated: () => auth.isAuthorized.value,
	}),
	end = ref<HTMLElement>(),
	codeOpen = ref(false);
watch(
	() => props.fixedModel,
	(value) => {
		if (props.simplified) store.settings.state.selectedModel = value ?? "";
	},
);
watch(
	() => store.history.state.messages,
	async () => {
		await nextTick();
		end.value?.scrollIntoView({ behavior: "smooth", block: "end" });
	},
);
watch(
	() => store.settings.state.mcpServers,
	(ids) => {
		for (const id of ids) if (id !== "__all__" && !store.catalog.state.tools[id]) void store.catalog.loadTools(id);
	},
	{ immediate: true },
);
const byok = computed(() => store.catalog.state.servers.find((server) => server.server_id === store.state.byokServer) ?? null);
onMounted(() => void store.catalog.load());
onBeforeUnmount(store.dispose);
defineExpose({ store });
</script>
<template>
	<div class="pg-chat" :class="{ 'pg-chat--simplified': simplified }">
		<div class="pg-chat__card">
			<div class="pg-chat__layout">
				<PlaygroundConfigurationComponent v-if="!simplified" :store="store" :disabled-personal-key-creation="disabled" />
				<main class="pg-chat__main">
					<PlaygroundRealtimeComponent
						v-if="store.settings.state.endpoint === 'realtime'"
						:auth="store.settings.auth()"
						:model="store.settings.state.selectedModel"
						:base-url="store.settings.state.customBaseUrl"
						:guardrails="store.settings.state.guardrails"
					/><template v-else
						><header class="pg-chat__header">
							<h2>{{ simplified ? "Chat" : "Test Key" }}</h2>
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
								:events="store.history.state.events"
								:code-result="store.settings.state.codeResult"
							/><PlaygroundMcpEventsComponent
								v-if="
									store.state.loading &&
									store.history.state.messages.at(-1)?.role === 'user' &&
									['chat', 'responses'].includes(store.settings.state.endpoint)
								"
								:events="store.history.state.events"
							/>
							<div v-if="store.state.loading" class="pg-chat__loading"><UiSpinner /></div>
							<div ref="end"></div>
						</div>
						<PlaygroundComposerComponent :store="store"
					/></template>
				</main>
			</div>
		</div>
		<PlaygroundCodeDialogComponent v-model:open="codeOpen" :store="store" /><PlaygroundByokDialogComponent
			:server="byok"
			@close="store.state.byokServer = null"
			@success="store.catalog.reloadServers()"
		/>
	</div>
</template>
