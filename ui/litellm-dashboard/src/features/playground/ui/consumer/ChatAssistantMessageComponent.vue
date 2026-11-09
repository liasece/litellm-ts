<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { copyText } from "../../../content/logic/ClipboardLogic";
import type { ChatMessage } from "../../support/ChatModels";
import MarkdownContent from "../../../content/ui/MarkdownContent.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
const props = defineProps<{ message: ChatMessage; last: boolean; streaming: boolean }>(),
	reasoning = ref(true),
	copied = ref(false),
	text = computed(() => props.message.content.replace(/\[stopped\]$/, "")),
	stopped = computed(() => props.message.content.endsWith("[stopped]"));
let timer: ReturnType<typeof setTimeout> | undefined;
async function copy() {
	try {
		await copyText(text.value);
		copied.value = true;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => (copied.value = false), 2000);
	} catch {
		/* Clipboard permission is optional. */
	}
}
onBeforeUnmount(() => {
	if (timer) clearTimeout(timer);
});
</script>
<template>
	<div v-if="last && streaming && !message.content" class="chat-typing"><i></i><i></i><i></i></div>
	<article v-else class="chat-assistant-message">
		<div v-if="last && streaming && !message.reasoningContent" class="chat-thinking"><span>Thinking...</span></div>
		<div v-else-if="message.reasoningContent" class="pg-message__reasoning">
			<button type="button" class="chat-reasoning-toggle" @click="reasoning = !reasoning">
				<UiIcon name="BulbOutlined" />{{ reasoning ? "Hide reasoning" : "Show reasoning"
				}}<UiIcon :name="reasoning ? 'DownOutlined' : 'RightOutlined'" />
			</button>
			<div v-if="reasoning" class="pg-message__reasoning-text">{{ message.reasoningContent }}</div>
		</div>
		<div class="chat-assistant-message__content">
			<MarkdownContent :source="text" /><i v-if="stopped" class="chat-assistant-message__stopped"> [stopped]</i>
		</div>
		<div class="chat-assistant-message__copy">
			<UiTooltip :title="copied ? 'Copied!' : 'Copy'"
				><button type="button" :aria-label="copied ? 'Copied!' : 'Copy'" :class="{ 'is-copied': copied }" @click="copy">
					<UiIcon :name="copied ? 'CheckOutlined' : 'CopyOutlined'" /></button
			></UiTooltip>
		</div>
	</article>
</template>
