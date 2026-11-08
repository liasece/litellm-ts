<script setup lang="ts">
import { computed, ref } from "vue";
import type { PlaygroundChatStore } from "../../stores/PlaygroundChatStore";
import { notify } from "../../logic/PlaygroundValueLogic";
import PlaygroundComposerInputComponent from "./PlaygroundComposerInputComponent.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
import PlaygroundToolArgumentsComponent from "./PlaygroundToolArgumentsComponent.vue";
const props = defineProps<{ store: PlaygroundChatStore }>(),
	config = props.store.settings.state,
	state = props.store.state,
	fileInput = ref<HTMLInputElement>(),
	imagesInput = ref<HTMLInputElement>(),
	audioInput = ref<HTMLInputElement>(),
	argumentsForm = ref<InstanceType<typeof PlaygroundToolArgumentsComponent>>();
const mode = computed(() => config.endpoint),
	tool = computed(() => props.store.catalog.state.tools[config.mcpServers[0]]?.find((tool) => tool.name === config.directTool));
const placeholder = computed(() =>
	["chat", "responses", "anthropic_messages", "embeddings"].includes(mode.value)
		? "Type your message... (Shift+Enter for new line)"
		: mode.value === "a2a_agents"
			? "Send a message to the A2A agent..."
			: mode.value === "image_edits"
				? "Describe how you want to edit the image..."
				: mode.value === "speech"
					? "Enter text to convert to speech..."
					: mode.value === "transcription"
						? "Optional: Add context or prompt for transcription..."
						: "Describe the image you want to generate...",
);
const disabled = computed(
	() =>
		state.loading ||
		(mode.value === "mcp"
			? !(config.mcpServers.length === 1 && config.mcpServers[0] !== "__all__" && config.directTool)
			: mode.value === "transcription"
				? !state.audio
				: !state.input.trim()),
);
const suggestions = computed(() =>
	mode.value === "a2a_agents"
		? ["What can you help me with?", "Tell me about yourself", "What tasks can you perform?"]
		: ["Write me a poem", "Explain quantum computing", "Draft a polite email requesting a meeting"],
);
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
function chooseImages(event: Event) {
	props.store.addImages(files(event));
	(event.target as HTMLInputElement).value = "";
}
function chooseAudio(event: Event) {
	state.audio = files(event)[0] ?? null;
	(event.target as HTMLInputElement).value = "";
}
function drop(event: DragEvent, kind: "images" | "audio") {
	const list = Array.from(event.dataTransfer?.files ?? []);
	if (kind === "images") props.store.addImages(list);
	else state.audio = list[0] ?? null;
}
async function send() {
	if (mode.value === "mcp" && argumentsForm.value) {
		try {
			state.toolArguments = argumentsForm.value.getSubmitValues();
		} catch (error) {
			notify("error", error instanceof Error ? error.message : "Invalid tool arguments");
			return;
		}
	}
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
			ref="imagesInput"
			type="file"
			accept="image/*"
			multiple
			hidden
			@change="chooseImages"
		/><input ref="audioInput" type="file" accept="audio/*,.mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm" hidden @change="chooseAudio" />
		<div v-if="mode === 'image_edits'" class="pg-upload-images">
			<div
				v-if="!state.images.length"
				class="pg-upload-drop"
				role="button"
				tabindex="0"
				@click="imagesInput?.click()"
				@keydown.enter="imagesInput?.click()"
				@dragover.prevent
				@drop.prevent="drop($event, 'images')"
			>
				<UiIcon name="PictureOutlined" />
				<p>Click or drag images to upload</p>
				<small>Support for PNG, JPG, JPEG formats. Multiple images supported.</small>
			</div>
			<div v-else class="pg-upload-images__list">
				<div v-for="(file, index) in state.images" :key="state.imageUrls[index]" class="pg-upload-images__item">
					<img :src="state.imageUrls[index]" :alt="file.name" /><button
						type="button"
						:aria-label="'Remove ' + file.name"
						@click="store.removeImage(index)"
					>
						<UiIcon name="DeleteOutlined" />
					</button>
				</div>
				<button type="button" class="pg-upload-images__add" @click="imagesInput?.click()">
					<UiIcon name="PictureOutlined" /><span>Add more</span>
				</button>
			</div>
		</div>
		<div v-if="mode === 'transcription'" class="pg-upload-audio">
			<div
				v-if="!state.audio"
				class="pg-upload-drop"
				role="button"
				tabindex="0"
				@click="audioInput?.click()"
				@keydown.enter="audioInput?.click()"
				@dragover.prevent
				@drop.prevent="drop($event, 'audio')"
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
		<div v-if="!store.history.state.messages.length && !state.loading && mode !== 'mcp'" class="pg-suggestions">
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
				<div
					v-if="mode === 'mcp' && config.mcpServers.length === 1 && config.mcpServers[0] !== '__all__' && config.directTool"
					class="pg-composer__tool-form"
				>
					<PlaygroundToolArgumentsComponent v-if="tool" ref="argumentsForm" :tool="tool" />
					<div v-else>Loading tool schema...</div>
				</div>
				<PlaygroundComposerInputComponent
					v-else
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
