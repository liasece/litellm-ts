<script setup lang="ts">
import { computed } from "vue";
import type { PlaygroundMessage } from "../../support/PlaygroundModels";
import PlaygroundMessageComponent from "../chat/PlaygroundMessageComponent.vue";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
const props = defineProps<{ messages: PlaygroundMessage[]; loading: boolean }>();
const blocks = computed(() => {
	const result: { user?: PlaygroundMessage; assistant?: PlaygroundMessage }[] = [];
	for (let i = 0; i < props.messages.length; i++) {
		const message = props.messages[i];
		if (message.role === "user") {
			const assistant = props.messages[i + 1]?.role === "assistant" ? props.messages[++i] : undefined;
			result.push({ user: message, assistant });
		} else if (message.role === "assistant") result.push({ assistant: message });
	}
	return result;
});
</script>
<template>
	<div class="pg-compare-messages">
		<div v-for="(block, index) in blocks" :key="block.user?.id || block.assistant?.id" class="pg-compare-messages__block">
			<template v-if="block.user"
				><div class="pg-compare-messages__heading">
					<span class="is-user"><UiLucideIcon name="UserRound" :size="16" /></span><strong>You</strong>
				</div>
				<PlaygroundMessageComponent :message="block.user" endpoint="chat" :events="[]" :last="false"
			/></template>
			<hr />
			<template v-if="block.assistant"
				><div class="pg-compare-messages__heading">
					<span><UiLucideIcon name="Bot" :size="16" /></span><strong>{{ block.assistant.model || "Assistant" }}</strong
					><small v-if="block.assistant.toolName">{{ block.assistant.toolName }}</small>
				</div>
				<PlaygroundMessageComponent :message="block.assistant" endpoint="chat" :events="[]" :last="false"
			/></template>
			<div v-else class="pg-inline pg-muted">
				<UiSpinner v-if="loading && index === blocks.length - 1" :size="18" />{{
					loading && index === blocks.length - 1 ? "Generating response..." : "Waiting for a response..."
				}}
			</div>
		</div>
	</div>
</template>
