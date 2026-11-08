<script setup lang="ts">
import UiIcon from "../../platform/ui/UiIcon.vue";
import MarkdownContent from "../../content/ui/MarkdownContent.vue";
import PlaygroundResponseMetricsComponent from "../../playground/ui/chat/PlaygroundResponseMetricsComponent.vue";
import type { PromptConversationMessage } from "../support/PromptModels";
defineProps<{ message: PromptConversationMessage }>();
</script>
<template>
	<div class="prompt-conversation-row" :class="{ 'is-user': message.role === 'user' }">
		<div class="prompt-conversation-bubble">
			<header>
				<span><UiIcon :name="message.role === 'user' ? 'UserOutlined' : 'RobotOutlined'" :size="12" /></span
				><strong>{{ message.role }}</strong
				><small v-if="message.role === 'assistant' && message.model">{{ message.model }}</small>
			</header>
			<div class="prompt-conversation-content">
				<MarkdownContent
					v-if="message.role === 'assistant'"
					:source="message.content"
					:gfm="false"
					highlight-code
					wrap-code-lines
				/>
				<div v-else>{{ message.content }}</div>
				<PlaygroundResponseMetricsComponent
					v-if="message.role === 'assistant' && (message.timeToFirstToken || message.totalLatency || message.usage)"
					:model="message.model"
					:time-to-first-token="message.timeToFirstToken"
					:total-latency="message.totalLatency"
					:usage="message.usage"
				/>
			</div>
		</div>
	</div>
</template>
