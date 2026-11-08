<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { ChatInferenceStore } from "../../stores/ChatInferenceStore";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiPopover from "../../../platform/ui/UiPopover.vue";
import ChatMcpPickerComponent from "./ChatMcpPickerComponent.vue";
const props = defineProps<{ store: ChatInferenceStore; inConversation: boolean }>(),
	textarea = ref<HTMLTextAreaElement>();
const state = props.store.state;
function resize() {
	const input = textarea.value;
	if (input) {
		input.style.height = "auto";
		input.style.height = Math.min(input.scrollHeight, 180) + "px";
	}
}
watch(
	() => state.input,
	async () => {
		await nextTick();
		resize();
	},
	{ immediate: true },
);
function key(event: KeyboardEvent) {
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		void props.store.submit();
	}
}
</script>
<template>
	<div class="chat-composer" :class="{ 'is-conversation': inConversation }">
		<textarea
			ref="textarea"
			v-model="state.input"
			:placeholder="inConversation ? 'Send a message...' : 'How can I help you today?'"
			@keydown="key"
		/>
		<div>
			<UiPopover trigger="click" placement="topLeft"
				><button type="button" class="chat-composer__mcp" aria-label="Connect MCP tools">
					<UiIcon name="PlusOutlined" /><span v-if="state.mcpServers.length">{{ state.mcpServers.length }}</span></button
				><template #content><ChatMcpPickerComponent :selected="state.mcpServers" @change="state.mcpServers = $event" /></template
			></UiPopover>
			<div class="chat-composer__right">
				<span v-if="!store.comparison.value">{{
					inConversation
						? state.mcpServers.length
							? state.mcpServers.length + " tool" + (state.mcpServers.length > 1 ? "s" : "") + " connected"
							: ""
						: state.selected[0] || "No model"
				}}</span
				><button
					v-if="store.loading.value"
					type="button"
					class="chat-composer__stop"
					aria-label="Stop response"
					@click="store.stop"
				>
					<i></i></button
				><button
					v-else
					type="button"
					class="chat-composer__send"
					:disabled="!state.input.trim() || state.loadingModels || !state.selected.length"
					@click="store.submit()"
				>
					Send
				</button>
			</div>
		</div>
	</div>
</template>
