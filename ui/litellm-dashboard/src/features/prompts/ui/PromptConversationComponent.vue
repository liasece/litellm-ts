<script setup lang="ts">
import { ref, toRef, watch, nextTick, onBeforeUnmount, computed } from "vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { createPromptConversationStore } from "../stores/PromptConversationStore";
import type { PromptDraft } from "../support/PromptModels";
import PromptConversationMessageComponent from "./PromptConversationMessageComponent.vue";
const props = defineProps<{ prompt: PromptDraft }>(),
	auth = useAuthenticationStore(),
	store = createPromptConversationStore(toRef(props, "prompt"), () => auth.isAuthorized.value),
	{ messages, variables, state, extracted, missing } = store,
	end = ref<HTMLDivElement>();
const variableLabel = (name: string) => "{{" + name + "}}";
const missingDescription = computed(() => missing.value.map(variableLabel).join(", "));
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
	messages,
	async () => {
		await nextTick();
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => end.value?.scrollIntoView({ behavior: "smooth", block: "end" }), 100);
	},
	{ deep: true, immediate: true },
);
function keydown(event: KeyboardEvent) {
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		void store.send();
	}
}
onBeforeUnmount(() => {
	if (timer) clearTimeout(timer);
	store.dispose();
});
</script>
<template>
	<div class="prompt-conversation">
		<section v-if="!state.variablesFilled && extracted.length" class="prompt-conversation-variables">
			<h3>Fill in template variables to start testing</h3>
			<div v-for="name in extracted" :key="name">
				<label>{{ variableLabel(name) }}</label
				><UiInput v-model="variables[name]" size="small" :placeholder="'Enter value for ' + name" />
			</div>
		</section>
		<div v-if="messages.length" class="prompt-conversation-clear">
			<UiButton appearance="tremor" @click="store.clear"
				><template #icon><UiIcon name="ClearOutlined" /></template>Clear Chat</UiButton
			>
		</div>
		<div class="prompt-conversation-messages">
			<div v-if="!messages.length" class="prompt-conversation-empty">
				<UiIcon name="RobotOutlined" :size="48" /><span>{{
					extracted.length
						? "Fill in the variables above, then type a message to start testing"
						: "Type a message below to start testing your prompt"
				}}</span>
			</div>
			<PromptConversationMessageComponent v-for="(message, index) in messages" :key="index" :message="message" />
			<div v-if="state.loading" class="prompt-conversation-loading"><UiIcon name="LoadingOutlined" :size="24" spin /></div>
			<div ref="end" style="height: 1px" />
		</div>
		<div class="prompt-conversation-compose">
			<div v-if="missing.length" class="prompt-variable-warning">
				<span>⚠️</span>
				<div>
					<p>Please fill in all template variables above</p>
					<small>Missing: {{ missingDescription }}</small>
				</div>
			</div>
			<div class="prompt-conversation-input-row">
				<div>
					<UiInput
						v-model="state.input"
						multiline
						:auto-size="{ minRows: 1, maxRows: 4 }"
						placeholder="Type your message... (Shift+Enter for new line)"
						:disabled="state.loading"
						@keydown="keydown"
					/><UiButton
						appearance="tremor"
						class="prompt-conversation-send"
						:disabled="state.loading || !state.input.trim() || missing.length > 0"
						aria-label="Send message"
						@click="store.send"
						><UiIcon name="ArrowUpOutlined" :size="14"
					/></UiButton>
				</div>
				<UiButton v-if="state.loading" appearance="tremor" class="prompt-conversation-cancel" @click="store.cancel"
					>Cancel</UiButton
				>
			</div>
		</div>
	</div>
</template>
