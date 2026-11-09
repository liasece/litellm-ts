<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { PlaygroundAuth } from "../../support/PlaygroundModels";
import { createPlaygroundRealtimeStore } from "../../stores/PlaygroundRealtimeStore";
import { voiceOptions } from "../../data/PlaygroundEndpointData";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
const props = defineProps<{ auth: PlaygroundAuth; model: string; baseUrl?: string }>(),
	store = createPlaygroundRealtimeStore({
		auth: () => props.auth,
		model: () => props.model,
		baseUrl: () => props.baseUrl,
	}),
	state = store.state,
	end = ref<HTMLElement>();
watch(
	() => state.messages,
	async () => {
		await nextTick();
		end.value?.scrollIntoView({ behavior: "smooth", block: "end" });
	},
);
onBeforeUnmount(store.dispose);
</script>
<template>
	<div class="pg-realtime">
		<header>
			<div class="pg-inline">
				<UiIcon name="SoundOutlined" /><strong>Realtime Voice Chat</strong
				><i class="pg-realtime__dot" :class="{ 'is-connected': state.connected }"></i
				><small>{{ state.connected ? "Connected" : state.connecting ? "Connecting..." : "Disconnected" }}</small>
			</div>
			<div class="pg-inline">
				<UiSelect
					:model-value="state.voice"
					size="small"
					:options="voiceOptions"
					:disabled="state.connected"
					style="width: 220px"
					@update:model-value="state.voice = String($event || 'alloy')"
				/><UiButton v-if="!state.connected" variant="primary" size="small" :loading="state.connecting" @click="store.connect"
					>Connect</UiButton
				><UiButton v-else variant="danger" size="small" @click="store.disconnect"
					><template #icon><UiIcon name="CloseCircleOutlined" /></template>Disconnect</UiButton
				>
			</div>
		</header>
		<div class="pg-realtime__messages">
			<div v-if="!state.messages.length && !state.connected" class="pg-realtime__empty">
				<UiIcon name="SoundOutlined" />
				<p>Realtime Voice Playground</p>
				<span
					>Click <b>Connect</b> to start a realtime session. You can speak using your microphone or type messages. The AI will
					respond with voice and text.</span
				>
			</div>
			<div
				v-for="message in state.messages"
				:key="message.id"
				class="pg-realtime__message"
				:class="'pg-realtime__message--' + message.role"
			>
				<div v-if="message.role === 'status'">{{ message.content }}</div>
				<div v-else>
					<strong>{{ message.role === "user" ? "You" : "AI" }}</strong
					><span>{{ message.content }}</span>
				</div>
			</div>
			<div ref="end"></div>
		</div>
		<footer v-if="state.connected">
			<div class="pg-inline">
				<UiButton
					:variant="state.recording ? 'danger' : 'default'"
					size="large"
					class="pg-realtime__mic"
					:title="state.recording ? 'Stop recording' : 'Start recording'"
					@click="state.recording ? store.stopRecording() : store.startRecording()"
					><UiIcon :name="state.recording ? 'AudioMutedOutlined' : 'AudioOutlined'" /></UiButton
				><UiInput
					v-model="state.input"
					size="large"
					placeholder="Type a message or use the mic..."
					class="pg-grow"
					@keydown.enter="store.sendText"
				/><UiButton
					variant="primary"
					size="large"
					:disabled="!state.input.trim()"
					aria-label="Send realtime message"
					@click="store.sendText"
					><UiIcon name="SendOutlined"
				/></UiButton>
			</div>
			<div v-if="state.recording" class="pg-realtime__listening">
				<i></i>Listening — speak into your microphone. Server VAD will detect when you stop.
			</div>
		</footer>
	</div>
</template>
