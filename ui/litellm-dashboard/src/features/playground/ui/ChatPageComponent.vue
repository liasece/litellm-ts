<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { getApiBaseUrl } from "../../platform/api/HttpApiClient";
import { createChatInferenceStore } from "../stores/ChatInferenceStore";
import { chatGreeting } from "../logic/ChatHistoryLogic";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import ChatConversationListComponent from "./consumer/ChatConversationListComponent.vue";
import ChatModelSelectorComponent from "./consumer/ChatModelSelectorComponent.vue";
import ChatComposerComponent from "./consumer/ChatComposerComponent.vue";
import ChatUserMessageComponent from "./consumer/ChatUserMessageComponent.vue";
import ChatAssistantMessageComponent from "./consumer/ChatAssistantMessageComponent.vue";
import ChatToolMessageComponent from "./consumer/ChatToolMessageComponent.vue";
import ChatComparisonComponent from "./consumer/ChatComparisonComponent.vue";
import ChatMcpAppsComponent from "./consumer/ChatMcpAppsComponent.vue";
import ChatMcpCredentialsComponent from "./consumer/ChatMcpCredentialsComponent.vue";
import "./consumer/ChatLayoutStyles.css";
import "./consumer/ChatModelSelectorStyles.css";
import "./consumer/ChatConversationStyles.css";
import "./consumer/ChatMessageStyles.css";
import "./consumer/ChatMcpStyles.css";
import "./chat/PlaygroundChatStyles.css";
import "./chat/PlaygroundMessageStyles.css";
const route = useRoute(),
	router = useRouter(),
	auth = useAuthenticationStore(),
	store = createChatInferenceStore((id, replace) => {
		const query = id ? { id } : {};
		void (replace ? router.replace({ path: route.path, query }) : router.push({ path: route.path, query }));
	}),
	state = store.state,
	collapsed = ref(false),
	view = ref<"chats" | "apps" | "credentials">(route.query.mcpOauthReturn === "apps" ? "apps" : "chats"),
	bannerDismissed = ref(false),
	messages = ref<HTMLElement>(),
	showScroll = ref(false),
	scrollLock = ref<number | null>(null);
const navigation = [
		{ key: "chats" as const, label: "Chats", icon: "MessageOutlined" },
		{ key: "apps" as const, label: "Apps", icon: "AppstoreOutlined" },
		{ key: "credentials" as const, label: "Credentials", icon: "KeyOutlined" },
	],
	greeting = computed(() => {
		const session = auth.state.session,
			name = session?.user_email?.split("@")[0] ?? session?.user_id ?? "";
		return chatGreeting() + (name ? ", " + name : "");
	}),
	blank = computed(() => (store.comparison.value ? !state.exchanges.length : !store.history.active.value?.messages.length)),
	dashboard = computed(() => {
		const path = window.location.pathname,
			index = path.indexOf("/ui");
		return index >= 0 ? path.slice(0, index + 3) + "/" : "/";
	}),
	logo = getApiBaseUrl() + "/get_image";
watch(
	() => route.query.id,
	(id) => store.select(typeof id === "string" ? id : null),
	{ immediate: true },
);
watch(
	() => store.history.active.value?.messages,
	async (next, previous) => {
		const count = next?.length ?? 0,
			prior = previous?.length ?? 0;
		await nextTick();
		if (messages.value) {
			if (count > prior) messages.value.scrollTop = messages.value.scrollHeight;
			else if (scrollLock.value !== null) messages.value.scrollTop = scrollLock.value;
		}
	},
);
watch(
	() => state.streaming,
	(value) => (scrollLock.value = value ? (messages.value?.scrollTop ?? 0) : null),
);
function scroll() {
	const el = messages.value;
	if (el) {
		showScroll.value = el.scrollHeight - el.scrollTop - el.clientHeight > 120;
		if (scrollLock.value !== null) scrollLock.value = el.scrollTop;
	}
}
function bottom() {
	if (messages.value) {
		messages.value.scrollTo({ top: messages.value.scrollHeight, behavior: "smooth" });
		if (scrollLock.value !== null) scrollLock.value = messages.value.scrollHeight;
	}
}
function select(id: string) {
	void router.push({ path: route.path, query: { id } });
}
onMounted(() => {
	void store.load();
	if (route.query.mcpOauthReturn) {
		const query = { ...route.query };
		delete query.mcpOauthReturn;
		void router.replace({ path: route.path, query });
	}
});
onBeforeUnmount(store.dispose);
defineExpose({ store });
</script>
<template>
	<div class="chat-page">
		<aside class="chat-sidebar" :class="{ 'is-collapsed': collapsed }">
			<header>
				<div v-if="!collapsed"><img :src="logo" alt="LiteLLM" /><strong>LiteLLM</strong></div>
				<UiTooltip :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'" placement="right"
					><button type="button" :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'" @click="collapsed = !collapsed">
						<UiIcon :name="collapsed ? 'MenuUnfoldOutlined' : 'MenuFoldOutlined'" /></button
				></UiTooltip>
			</header>
			<nav>
				<UiTooltip :title="collapsed ? 'New chat' : undefined" placement="right"
					><button type="button" @click="store.newChat">
						<span class="chat-sidebar__nav-icon"><UiIcon name="EditOutlined" /></span><span v-if="!collapsed">New chat</span>
					</button></UiTooltip
				><UiTooltip :title="collapsed ? 'Search chats' : undefined" placement="right"
					><button type="button" @click="view = 'chats'">
						<span class="chat-sidebar__nav-icon"><UiIcon name="SearchOutlined" /></span
						><span v-if="!collapsed">Search chats</span>
					</button></UiTooltip
				>
			</nav>
			<hr />
			<nav>
				<UiTooltip v-for="item in navigation" :key="item.key" :title="collapsed ? item.label : undefined" placement="right"
					><button type="button" :class="{ 'is-active': view === item.key }" @click="view = item.key">
						<span class="chat-sidebar__nav-icon"><UiIcon :name="item.icon" /></span
						><span v-if="!collapsed">{{ item.label }}</span>
					</button></UiTooltip
				><UiTooltip :title="collapsed ? 'Back to Developer Console UI' : undefined" placement="right"
					><a :href="dashboard"
						><UiIcon name="ArrowLeftOutlined" /><span v-if="!collapsed">Back to Developer Console UI</span></a
					></UiTooltip
				>
			</nav>
			<hr />
			<ChatConversationListComponent
				v-if="!collapsed && view === 'chats'"
				:history="store.history"
				@select="select"
				@remove="store.remove"
				@new="store.newChat"
			/>
		</aside>
		<main>
			<header>
				<ChatModelSelectorComponent :store="store" /><UiTooltip title="Settings"
					><button type="button" aria-label="Settings"><UiIcon name="SettingOutlined" /></button
				></UiTooltip>
			</header>
			<div v-if="store.history.state.storageUnavailable && !bannerDismissed" class="chat-storage-banner">
				<span>Chat history won't be saved in this browser session.</span
				><button type="button" aria-label="Dismiss storage warning" @click="bannerDismissed = true">×</button>
			</div>
			<div class="chat-page__content">
				<div v-if="view === 'apps'" class="chat-page__apps">
					<ChatMcpAppsComponent :selected="state.mcpServers" @change="state.mcpServers = $event" />
				</div>
				<div v-else-if="view === 'credentials'" class="chat-page__apps"><ChatMcpCredentialsComponent /></div>
				<div v-else-if="blank" class="chat-blank">
					<h1>{{ store.comparison.value ? "Compare " + state.selected.length + " models" : greeting }}</h1>
					<p v-if="store.comparison.value">Send a message to see responses side-by-side</p>
					<p v-else>
						Chat with 100+ LLMs + MCP tools — authenticate once, use them here.
						<button type="button" @click="view = 'apps'">Open Apps →</button>
					</p>
					<div><ChatComposerComponent :store="store" :in-conversation="false" /></div>
					<div v-if="!store.comparison.value" class="chat-blank__suggestions">
						<button
							v-for="suggestion in ['Write', 'Learn', 'Code', 'Brainstorm']"
							:key="suggestion"
							type="button"
							@click="state.input = suggestion + ': '"
						>
							{{ suggestion }}
						</button>
					</div>
				</div>
				<div
					v-else
					class="chat-conversation"
					:style="{ maxWidth: store.comparison.value ? (state.selected.length >= 3 ? 1200 : 960) + 'px' : '760px' }"
				>
					<div ref="messages" class="chat-conversation__messages" @scroll.passive="scroll">
						<ChatComparisonComponent v-if="store.comparison.value" :store="store" />
						<div v-else class="chat-message-list">
							<template v-for="(message, index) in store.history.active.value?.messages" :key="message.id"
								><ChatUserMessageComponent
									v-if="message.role === 'user'"
									:message="message"
									:streaming="state.streaming"
									@edit="store.edit" /><ChatToolMessageComponent
									v-else-if="message.role === 'tool'"
									:message="message" /><ChatAssistantMessageComponent
									v-else
									:message="message"
									:streaming="state.streaming"
									:last="index === (store.history.active.value?.messages.length ?? 0) - 1"
							/></template>
						</div>
					</div>
					<button v-if="showScroll" type="button" class="chat-conversation__bottom" aria-label="Scroll to bottom" @click="bottom">
						<UiIcon name="DownOutlined" />
					</button>
					<div class="chat-conversation__composer"><ChatComposerComponent :store="store" in-conversation /></div>
				</div>
			</div>
		</main>
	</div>
</template>
