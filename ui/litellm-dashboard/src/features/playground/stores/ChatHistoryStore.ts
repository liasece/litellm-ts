import { computed, shallowReactive, watch } from "vue";
import { z } from "zod";
import { conversationSchema, type ChatConversation, type ChatMessage } from "../support/ChatModels";
import { chatTitle, trimChatHistory } from "../logic/ChatHistoryLogic";
import type { PlaygroundStorage } from "../logic/PlaygroundStorageLogic";
const key = "litellm_chat_history_v1";
export function createChatHistoryStore(storage?: PlaygroundStorage) {
	const state = shallowReactive({ conversations: [] as ChatConversation[], activeId: null as string | null, storageUnavailable: false });
	try {
		storage ??= window.localStorage;
		const raw = storage?.getItem(key);
		if (raw) state.conversations = z.array(conversationSchema).parse(JSON.parse(raw));
	} catch {
		state.storageUnavailable = true;
	}
	const active = computed(() => state.conversations.find((item) => item.id === state.activeId) ?? null);
	function persist() {
		if (state.storageUnavailable) return;
		try {
			storage?.setItem(key, JSON.stringify(state.conversations));
		} catch {
			state.storageUnavailable = true;
		}
	}
	const stop = watch(() => state.conversations, persist, { flush: "post" });
	function select(id: string | null) {
		state.activeId = id && state.conversations.some((item) => item.id === id) ? id : null;
		return state.activeId === id;
	}
	function create(model: string) {
		const id = crypto.randomUUID(),
			now = Date.now();
		state.conversations = trimChatHistory([
			{ id, title: "New conversation", model, messages: [], mcpServerNames: [], createdAt: now, updatedAt: now },
			...state.conversations,
		]);
		state.activeId = id;
		return id;
	}
	function update(id: string, change: (item: ChatConversation) => ChatConversation) {
		state.conversations = trimChatHistory(state.conversations.map((item) => (item.id === id ? change(item) : item)));
	}
	function append(id: string, message: Omit<ChatMessage, "id" | "timestamp">) {
		const value = { ...message, id: crypto.randomUUID(), timestamp: Date.now() };
		update(id, (item) => ({
			...item,
			title:
				item.title === "New conversation" && message.role === "user" && !item.messages.some((message) => message.role === "user")
					? chatTitle(message.content)
					: item.title,
			messages: [...item.messages, value],
			updatedAt: Date.now(),
		}));
	}
	function assistant(id: string, patch: Partial<Pick<ChatMessage, "content" | "reasoningContent" | "mcpEvents">>) {
		update(id, (item) => {
			let index = -1;
			for (let cursor = item.messages.length - 1; cursor >= 0; cursor--) {
				if (item.messages[cursor].role === "assistant") {
					index = cursor;
					break;
				}
			}
			if (index < 0) return item;
			const messages = [...item.messages];
			messages[index] = { ...messages[index], ...patch };
			return { ...item, messages, updatedAt: Date.now() };
		});
	}
	function truncate(id: string, messageId: string) {
		update(id, (item) => {
			const index = item.messages.findIndex((message) => message.id === messageId);
			return index < 0 ? item : { ...item, messages: item.messages.slice(0, index), updatedAt: Date.now() };
		});
	}
	function remove(id: string) {
		state.conversations = state.conversations.filter((item) => item.id !== id);
		if (state.activeId === id) state.activeId = null;
	}
	function rename(id: string, title: string) {
		if (title.trim()) update(id, (item) => ({ ...item, title: title.trim(), updatedAt: Date.now() }));
	}
	function dispose() {
		persist();
		stop();
	}
	return { state, active, select, create, append, assistant, truncate, remove, rename, persist, dispose };
}
export type ChatHistoryStore = ReturnType<typeof createChatHistoryStore>;
