<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ChatHistoryStore } from "../../stores/ChatHistoryStore";
import { groupedChatHistory } from "../../logic/ChatHistoryLogic";
import ChatConversationRowComponent from "./ChatConversationRowComponent.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiDialog from "../../../platform/ui/UiDialog.vue";
const props = defineProps<{ history: ChatHistoryStore }>(),
	emit = defineEmits<{ select: [string]; remove: [string]; new: [] }>(),
	searchOpen = ref(false),
	query = ref(""),
	groups = computed(() => groupedChatHistory(props.history.state.conversations)),
	matches = computed(() =>
		props.history.state.conversations.filter(
			(item) => !query.value.trim() || item.title.toLowerCase().includes(query.value.trim().toLowerCase()),
		),
	);
function key(event: KeyboardEvent) {
	if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
		event.preventDefault();
		searchOpen.value = !searchOpen.value;
	}
}
function select(id: string) {
	emit("select", id);
	searchOpen.value = false;
}
watch(searchOpen, (value) => {
	if (!value) query.value = "";
});
onMounted(() => document.addEventListener("keydown", key));
onBeforeUnmount(() => document.removeEventListener("keydown", key));
defineExpose({ openSearch: () => (searchOpen.value = true) });
</script>
<template>
	<div class="chat-conversations">
		<header>
			<UiTooltip title="Chats are saved locally in this browser. All requests are logged in Spend → Logs." placement="right"
				><UiButton variant="primary" @click="emit('new')"
					><template #icon><UiIcon name="PlusOutlined" /></template>New Chat</UiButton
				></UiTooltip
			>
		</header>
		<div class="chat-conversations__list">
			<div v-if="!groups.length" class="chat-conversations__empty">No conversations yet.<br />Start a new chat above.</div>
			<section v-for="group in groups" :key="group.group">
				<h3>{{ group.group }}</h3>
				<ChatConversationRowComponent
					v-for="conversation in group.items"
					:key="conversation.id"
					:conversation="conversation"
					:active="conversation.id === history.state.activeId"
					@select="select"
					@remove="emit('remove', $event)"
					@rename="history.rename"
				/>
			</section>
		</div>
		<footer>
			<span><UiIcon name="UserOutlined" /></span><span>My Account</span>
		</footer>
		<UiDialog :show-footer="false" v-model:open="searchOpen" :width="480" scroll-mode="overlay" class="chat-search-dialog"
			><UiInput v-model="query" autofocus clearable placeholder="Search conversations…"
				><template #prefix><UiIcon name="SearchOutlined" /></template
			></UiInput>
			<div class="chat-search-dialog__results">
				<p v-if="!matches.length">No conversations found</p>
				<button v-for="conversation in matches" :key="conversation.id" type="button" @click="select(conversation.id)">
					<UiIcon name="MessageOutlined" /><span>{{
						conversation.title.length > 55 ? conversation.title.slice(0, 55) + "…" : conversation.title
					}}</span
					><small>{{ new Date(conversation.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) }}</small>
				</button>
			</div></UiDialog
		>
	</div>
</template>
