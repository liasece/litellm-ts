<script setup lang="ts">
import { computed } from "vue";
import type { ChatMessage } from "../../support/ChatModels";
import { chatTimestamp, redactChatToolArguments } from "../../logic/ChatHistoryLogic";
import { json } from "../../logic/PlaygroundValueLogic";
import UiIcon from "../../../platform/ui/UiIcon.vue";
const props = defineProps<{ message: ChatMessage }>(),
	args = computed(() => redactChatToolArguments(props.message.toolArgs));
</script>
<template>
	<article class="chat-tool-message">
		<details>
			<summary><UiIcon name="RightOutlined" /><UiIcon name="ToolOutlined" />{{ message.toolName || "Tool call" }}</summary>
			<div>
				<section v-if="message.toolArgs">
					<h4>Arguments</h4>
					<pre>{{ json(args, true) }}</pre>
				</section>
				<section v-if="message.toolResult">
					<h4>Result</h4>
					<div>{{ message.toolResult }}</div>
				</section>
			</div>
		</details>
		<small>{{ chatTimestamp(message.timestamp) }}</small>
	</article>
</template>
