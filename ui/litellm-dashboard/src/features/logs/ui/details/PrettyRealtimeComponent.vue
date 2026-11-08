<script setup lang="ts">
import { computed, ref } from "vue";
import { asRecord } from "../../logic/PrettyMessagesBlocksLogic";
import { recordArray, realtimeTranscripts, tokenLabel } from "../../logic/PrettyMessagesRealtimeLogic";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import PrettySectionHeaderComponent from "./PrettySectionHeaderComponent.vue";
const props = defineProps<{ response: unknown; metrics?: { completion_tokens?: number; output_cost?: number } }>();
const events = computed(() => recordArray(asRecord(props.response)?.results));
const session = computed(() =>
	asRecord(events.value.find((event) => event.type === "session.created" || event.type === "session.updated")?.session),
);
const responses = computed(() =>
	events.value
		.filter((event) => event.type === "response.done")
		.flatMap((event) => {
			const record = asRecord(event.response);
			return record ? [record] : [];
		}),
);
const sessionCollapsed = ref(true),
	conversationCollapsed = ref(false);
const configRows = computed(() => {
	const s = session.value ?? {};
	return [
		["Model", s.model],
		["Voice", s.voice],
		["Temperature", s.temperature],
		["Max Output Tokens", s.max_response_output_tokens],
		["Input Audio Format", s.input_audio_format],
		["Output Audio Format", s.output_audio_format],
		["Turn Detection", asRecord(s.turn_detection)?.type],
		["Tools", Array.isArray(s.tools) && s.tools.length ? s.tools.length + " tool(s)" : undefined],
	].filter(([, value]) => value !== undefined && value !== null);
});
function number(value: unknown) {
	return typeof value === "number" ? value : undefined;
}
function tokenEntries(value: unknown) {
	return Object.entries(asRecord(value) ?? {}).filter(([, item]) => typeof item === "number");
}
function copy() {
	void navigator.clipboard.writeText(realtimeTranscripts(responses.value));
}
</script>
<template>
	<div>
		<div v-if="session" class="pretty-card pretty-card--input">
			<div class="pretty-section-header" @click="sessionCollapsed = !sessionCollapsed">
				<div class="pretty-section-header__left">
					<UiIcon :name="sessionCollapsed ? 'DownOutlined' : 'UpOutlined'" class="pretty-section-header__arrow" /><span
						class="pretty-section-header__title"
						><UiIcon name="SettingOutlined" /> Session</span
					><span class="pretty-section-header__metric">{{ session.model }}</span
					><UiTag v-if="responses.length" color="purple"
						>{{ responses.length }} {{ responses.length === 1 ? "turn" : "turns" }}</UiTag
					><UiTag v-if="session.voice" color="blue"><UiIcon name="SoundOutlined" /> {{ session.voice }}</UiTag
					><UiTag v-for="modality in Array.isArray(session.modalities) ? session.modalities : []" :key="String(modality)"
						><UiIcon :name="modality === 'audio' ? 'AudioOutlined' : 'MessageOutlined'" /> {{ modality }}</UiTag
					>
				</div>
			</div>
			<div
				class="pretty-card__animation"
				:style="{ maxHeight: sessionCollapsed ? '0px' : '10000px', opacity: sessionCollapsed ? 0 : 1 }"
			>
				<div class="pretty-card__body">
					<div class="pretty-realtime-config">
						<div v-for="[label, value] in configRows" :key="String(label)">
							<span class="ld-secondary" style="font-size: 11px">{{ label }}</span>
							<div>{{ String(value) }}</div>
						</div>
					</div>
					<div v-if="session.instructions" style="margin-top: 12px">
						<span class="pretty-label pretty-label--block">Instructions</span>
						<div class="pretty-realtime-instructions">{{ session.instructions }}</div>
					</div>
				</div>
			</div>
		</div>
		<div v-if="responses.length" class="pretty-card">
			<PrettySectionHeaderComponent
				type="output"
				:tokens="metrics?.completion_tokens ?? number(asRecord(asRecord(response)?.usage)?.total_tokens)"
				:cost="metrics?.output_cost"
				:turn-count="responses.length"
				:collapsed="conversationCollapsed"
				@toggle="conversationCollapsed = !conversationCollapsed"
				@copy="copy"
			/>
			<div
				class="pretty-card__animation"
				:style="{ maxHeight: conversationCollapsed ? '0px' : '10000px', opacity: conversationCollapsed ? 0 : 1 }"
			>
				<div class="pretty-card__body">
					<div v-for="(turn, index) in responses" :key="String(turn.id || index)" class="pretty-realtime-turn">
						<div class="pretty-realtime-turn__header">
							<UiTag :color="turn.status === 'completed' ? 'green' : 'orange'">{{ turn.status || "unknown" }}</UiTag
							><span v-if="turn.usage" class="ld-secondary"
								>{{ asRecord(turn.usage)?.input_tokens ?? 0 }} in / {{ asRecord(turn.usage)?.output_tokens ?? 0 }} out
								tokens</span
							><span v-if="turn.conversation_id" class="ld-secondary" :title="String(turn.conversation_id)"
								>conv: {{ String(turn.conversation_id).slice(0, 12) }}...</span
							>
						</div>
						<div
							v-for="(output, outputIndex) in recordArray(turn.output)"
							:key="String(output.id || outputIndex)"
							class="pretty-realtime-output"
						>
							<template v-if="recordArray(output.content).some((content) => content.transcript || content.text)"
								><span class="pretty-label pretty-label--block">{{
									String(output.role || "assistant").toUpperCase()
								}}</span>
								<div
									v-for="(content, contentIndex) in recordArray(output.content)"
									:key="contentIndex"
									class="pretty-realtime-output__part"
								>
									<template v-if="content.transcript || content.text"
										><UiIcon
											v-if="content.type === 'audio' || content.type === 'text'"
											:name="content.type === 'audio' ? 'AudioOutlined' : 'MessageOutlined'"
										/>
										<div class="pretty-text">{{ content.transcript || content.text }}</div></template
									>
								</div></template
							>
						</div>
						<template v-for="kind in ['input', 'output']" :key="kind"
							><div
								v-if="tokenEntries(asRecord(turn.usage)?.[kind + '_token_details']).length"
								class="pretty-realtime-breakdown"
							>
								<span class="pretty-label">{{ kind }} Token Breakdown</span>
								<div class="pretty-meta-tags">
									<UiTag v-for="[key, value] in tokenEntries(asRecord(turn.usage)?.[kind + '_token_details'])" :key="key"
										>{{ tokenLabel(key) }}: {{ Number(value).toLocaleString() }}</UiTag
									>
								</div>
							</div></template
						>
					</div>
				</div>
			</div>
		</div>
		<div v-if="!session && !responses.length" class="pretty-realtime-empty">No recognized realtime events found</div>
	</div>
</template>
