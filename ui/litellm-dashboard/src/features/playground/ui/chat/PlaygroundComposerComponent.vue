<script setup lang="ts">
import { computed, ref } from "vue";
import type { PlaygroundChatStore } from "../../stores/PlaygroundChatStore";
import PlaygroundComposerInputComponent from "./PlaygroundComposerInputComponent.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
const props = defineProps<{ store: PlaygroundChatStore }>(),
	config = props.store.settings.state,
	state = props.store.state,
	fileInput = ref<HTMLInputElement>(),
	audioInput = ref<HTMLInputElement>();
const mode = computed(() => config.endpoint);
const placeholder = computed(() =>
	["chat", "responses", "anthropic_messages", "embeddings"].includes(mode.value)
		? "Type your message... (Shift+Enter for new line)"
		: mode.value === "speech"
			? "Enter text to convert to speech..."
			: mode.value === "transcription"
				? "Optional: Add context or prompt for transcription..."
				: "Describe the image you want to generate...",
);
const disabled = computed(() => state.loading || (mode.value === "transcription" ? !state.audio : !state.input.trim()));
const suggestions = ["Write me a poem", "Explain quantum computing", "Draft a polite email requesting a meeting"];
const codePrompts = [
	"Generate sample sales data CSV and create a chart",
	"Create a PNG bar chart comparing AI gateway providers including LiteLLM",
	"Generate a CSV of LLM pricing data and visualize it as a line chart",
];
function files(event: Event) {
	return Array.from((event.target as HTMLInputElement).files ?? []);
}
function chooseSingle(event: Event) {
	props.store.singleImage(files(event)[0] ?? null);
	(event.target as HTMLInputElement).value = "";
}
function chooseAudio(event: Event) {
	state.audio = files(event)[0] ?? null;
	(event.target as HTMLInputElement).value = "";
}
function drop(event: DragEvent) {
	state.audio = Array.from(event.dataTransfer?.files ?? [])[0] ?? null;
}
async function send() {
	await props.store.send();
}
function key(event: KeyboardEvent) {
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		if (!disabled.value) void send();
	}
}
</script>
<template>
	<footer class="pg-composer">
		<input ref="fileInput" type="file" accept="image/*,.pdf" hidden @change="chooseSingle" /><input
			ref="audioInput"
			type="file"
			accept="audio/*,.mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm"
			hidden
			@change="chooseAudio"
		/>
		<div v-if="mode === 'transcription'" class="pg-upload-audio">
			<div
				v-if="!state.audio"
				class="pg-upload-drop"
				role="button"
				tabindex="0"
				@click="audioInput?.click()"
				@keydown.enter="audioInput?.click()"
				@dragover.prevent
				@drop.prevent="drop"
			>
				<UiIcon name="SoundOutlined" />
				<p>Click or drag audio file to upload</p>
				<small>Support for MP3, MP4, MPEG, MPGA, M4A, WAV, WEBM formats. Max file size: 25 MB.</small>
			</div>
			<div v-else class="pg-upload-file pg-upload-file--audio">
				<div class="pg-upload-file__audio">
					<UiIcon name="SoundOutlined" /><span>{{ state.audio.name }}</span
					><small>({{ (state.audio.size / 1024 / 1024).toFixed(2) }} MB)</small>
				</div>
				<button type="button" @click="state.audio = null"><UiIcon name="DeleteOutlined" /> Remove</button>
			</div>
		</div>
		<div v-if="state.singleImage && ['chat', 'responses'].includes(mode)" class="pg-upload-file">
			<span v-if="state.singleImage.name.toLowerCase().endsWith('.pdf')" class="pg-upload-file__pdf"
				><UiIcon name="FilePdfOutlined" /></span
			><img v-else :src="state.singleImageUrl" alt="Upload preview" />
			<div>
				<strong>{{ state.singleImage.name }}</strong
				><small>{{ state.singleImage.name.toLowerCase().endsWith(".pdf") ? "PDF" : "Image" }}</small>
			</div>
			<button type="button" aria-label="Remove attachment" @click="store.singleImage(null)"><UiIcon name="DeleteOutlined" /></button>
		</div>
		<div v-if="mode === 'responses' && config.codeEnabled" class="pg-code-banner">
			<div class="pg-between">
				<span class="pg-inline"
					><UiSpinner v-if="state.loading" :size="16" /><UiIcon v-else name="CodeOutlined" />{{
						state.loading ? "Running Python code..." : "Code Interpreter Active"
					}}</span
				><button type="button" @click="config.codeEnabled = false">Disable</button>
			</div>
			<div v-if="!state.loading" class="pg-code-banner__prompts">
				<button v-for="prompt in codePrompts" :key="prompt" type="button" @click="state.input = prompt">{{ prompt }}</button>
			</div>
		</div>
		<div v-if="!store.history.state.messages.length && !state.loading" class="pg-suggestions">
			<button v-for="suggestion in suggestions" :key="suggestion" type="button" @click="state.input = suggestion">
				{{ suggestion }}
			</button>
		</div>
		<div class="pg-composer__row">
			<div class="pg-composer__input">
				<div class="pg-composer__tools">
					<UiTooltip v-if="['chat', 'responses'].includes(mode) && !state.singleImage" title="Attach image or PDF"
						><button type="button" class="pg-attachment" aria-label="Attach image or PDF" @click="fileInput?.click()">
							<UiIcon name="PaperClipOutlined" /></button></UiTooltip
					><UiTooltip
						v-if="mode === 'responses'"
						:title="config.codeEnabled ? 'Code Interpreter enabled (click to disable)' : 'Enable Code Interpreter'"
						><button
							type="button"
							:class="{ 'is-active': config.codeEnabled }"
							aria-label="Toggle Code Interpreter"
							@click="config.codeEnabled = !config.codeEnabled"
						>
							<UiIcon name="CodeOutlined" /></button
					></UiTooltip>
				</div>
				<PlaygroundComposerInputComponent
					v-model="state.input"
					:placeholder="placeholder"
					:disabled="state.loading"
					class="pg-composer__textarea"
					@keydown="key"
				/><button type="button" class="pg-send" aria-label="Send message" :disabled="disabled" @click="send">
					<UiIcon name="ArrowUpOutlined" />
				</button>
			</div>
			<UiButton v-if="state.loading" appearance="tremor" class="pg-cancel" @click="store.cancel()"
				><template #icon><UiIcon name="DeleteOutlined" /></template>Cancel</UiButton
			>
		</div>
	</footer>
</template>
