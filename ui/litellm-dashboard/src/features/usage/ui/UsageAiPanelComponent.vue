<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import MarkdownContent from "../../content/ui/MarkdownContent.vue";
import UsageAiToolStep from "./UsageAiToolStepComponent.vue";
import { createUsageAiStore } from "../stores/UsageAiStore";
const props = defineProps<{ open: boolean }>(),
	emit = defineEmits<{ "update:open": [value: boolean] }>();
const store = createUsageAiStore(),
	{ state } = store,
	end = ref<HTMLElement>();
watch(
	() => props.open,
	(value) => {
		if (value) void store.loadModels();
	},
	{ immediate: true },
);
watch(
	() => [state.messages.length, state.streaming, JSON.stringify(state.tools), state.status],
	async () => {
		await nextTick();
		end.value?.scrollIntoView?.({ behavior: "smooth" });
	},
	{ immediate: true },
);
onBeforeUnmount(() => store.dispose());
function close() {
	store.stop();
	emit("update:open", false);
}
function model(value: unknown) {
	state.selectedModel = typeof value === "string" ? value : "";
}
function keydown(event: KeyboardEvent) {
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		void store.send();
	}
}
</script>
<template>
	<div data-testid="usage-ai-chat-panel" class="usage-ai-panel" :class="{ 'usage-ai-panel--open': open }">
		<header>
			<div>
				<div>
					<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
						<path
							d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11 6.5 7.5 3 6l3.5-1.5L8 1zm4 7l.75 1.75L14.5 10.5l-1.75.75L12 13l-.75-1.75L9.5 10.5l1.75-.75L12 8zM4 9l.75 1.75L6.5 11.5l-1.75.75L4 14l-.75-1.75L1.5 11.5l1.75-.75L4 9z"
						/>
					</svg>
					<h3>Ask AI</h3>
				</div>
				<button aria-label="Close" @click="close">
					<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
			<p>Ask about your spend, models, keys, and trends</p>
		</header>
		<div class="usage-ai-model">
			<UiSelect
				:model-value="state.selectedModel || null"
				placeholder="Select a model (optional, defaults to gpt-4o-mini)"
				:options="state.models.map((model) => ({ label: model, value: model }))"
				:loading="state.modelsLoading"
				searchable
				clearable
				size="small"
				@update:model-value="model"
			/>
		</div>
		<div class="usage-ai-messages">
			<div v-if="!state.messages.length && !state.streaming && !state.loading" class="usage-ai-empty">
				<svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.5"
						d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
					/>
				</svg>
				<p>Ask a question about your usage</p>
				<small>e.g. "Which model costs me the most?"</small>
			</div>
			<div v-for="(message, i) in state.messages" :key="i" :class="'usage-ai-message usage-ai-message--' + message.role">
				<div v-if="message.role === 'user'" class="usage-ai-user-row">
					<div class="usage-ai-user">{{ message.content }}</div>
				</div>
				<div v-else class="usage-ai-assistant-content">
					<div v-if="message.toolCalls?.length" class="usage-ai-tool-group">
						<UsageAiToolStep v-for="(step, j) in message.toolCalls" :key="j" :step="step" />
					</div>
					<div class="usage-ai-assistant"><MarkdownContent :source="message.content" :gfm="false" /></div>
				</div>
			</div>
			<template v-if="state.loading"
				><div v-if="state.tools.length" class="usage-ai-tool-group">
					<UsageAiToolStep v-for="(step, i) in state.tools" :key="i" :step="step" />
				</div>
				<div v-if="!state.streaming" class="usage-ai-thinking">
					<UiSpinner :size="14" /><i>{{ state.status || "Thinking..." }}</i>
				</div></template
			>
			<div v-if="state.streaming" class="usage-ai-assistant"><MarkdownContent :source="state.streaming" :gfm="false" /></div>
			<div ref="end" />
		</div>
		<footer>
			<div>
				<UiInput
					v-model="state.input"
					multiline
					:auto-size="{ minRows: 1, maxRows: 3 }"
					placeholder="Ask about your usage..."
					:disabled="state.loading"
					@keydown="keydown"
				/><UiButton variant="primary" :disabled="!state.input.trim() || state.loading" :loading="state.loading" @click="store.send"
					>Send</UiButton
				>
			</div>
			<div><button :disabled="!state.messages.length" @click="store.clear">Clear chat</button><span>Enter to send</span></div>
		</footer>
	</div>
</template>
