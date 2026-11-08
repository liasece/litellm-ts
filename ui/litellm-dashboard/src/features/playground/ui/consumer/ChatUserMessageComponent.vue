<script setup lang="ts">
import { nextTick, ref } from "vue";
import type { ChatMessage } from "../../support/ChatModels";
import { chatTimestamp } from "../../logic/ChatHistoryLogic";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
const props = defineProps<{ message: ChatMessage; streaming: boolean }>(),
	emit = defineEmits<{ edit: [string, string] }>(),
	editing = ref(false),
	value = ref(""),
	input = ref<HTMLTextAreaElement>();
async function start() {
	value.value = props.message.content;
	editing.value = true;
	await nextTick();
	resize();
	input.value?.focus();
	input.value?.setSelectionRange(value.value.length, value.value.length);
}
function resize() {
	if (input.value) {
		input.value.style.height = "auto";
		input.value.style.height = input.value.scrollHeight + "px";
	}
}
function save() {
	const text = value.value.trim();
	if (text && text !== props.message.content) emit("edit", props.message.id, text);
	editing.value = false;
}
function key(event: KeyboardEvent) {
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		save();
	}
	if (event.key === "Escape") editing.value = false;
}
</script>
<template>
	<div class="chat-user-message">
		<div v-if="editing" class="chat-user-message__editor">
			<textarea ref="input" v-model="value" @input="resize" @keydown="key" />
			<div>
				<button type="button" @click="editing = false">Cancel</button
				><button type="button" :disabled="!value.trim()" @click="save">Save &amp; Send</button>
			</div>
		</div>
		<template v-else
			><div class="chat-user-message__row">
				<UiTooltip v-if="!streaming" title="Edit message"
					><button type="button" class="chat-user-message__edit" aria-label="Edit message" @click="start">
						<UiIcon name="EditOutlined" /></button
				></UiTooltip>
				<div>{{ message.content }}</div>
			</div>
			<small>{{ chatTimestamp(message.timestamp) }}</small></template
		>
	</div>
</template>
