<script setup lang="ts">
import { computed, ref } from "vue";
import { parseRequestMessages, parseResponseMessage } from "../../logic/PrettyMessagesParseLogic";
import { hasRequestMetaBody, parseRequestMeta } from "../../logic/PrettyMessagesMetaLogic";
import { copyDetail } from "../../logic/LogDetailsDisplayLogic";
import PrettySectionHeaderComponent from "./PrettySectionHeaderComponent.vue";
import PrettyCollapsibleComponent from "./PrettyCollapsibleComponent.vue";
import PrettySimpleMessageComponent from "./PrettySimpleMessageComponent.vue";
import PrettyInputToolsComponent from "./PrettyInputToolsComponent.vue";
import PrettyRealtimeComponent from "./PrettyRealtimeComponent.vue";
import { isRealtimeResponse } from "../../logic/PrettyMessagesRealtimeLogic";
import UiTag from "../../../platform/ui/UiTag.vue";
const props = defineProps<{
	request: unknown;
	response: unknown;
	metaRequest?: unknown;
	metrics?: { prompt_tokens?: number; completion_tokens?: number; input_cost?: number; output_cost?: number };
}>();
const messages = computed(() => parseRequestMessages(props.request)),
	responseMessage = computed(() => parseResponseMessage(props.response));
const meta = computed(() =>
	parseRequestMeta(props.metaRequest && hasRequestMetaBody(props.metaRequest) ? props.metaRequest : props.request),
);
const system = computed(() => messages.value.find((message) => message.role === "system"));
const conversation = computed(() => messages.value.filter((message) => message.role !== "system"));
const history = computed(() => conversation.value.slice(0, -1)),
	last = computed(() => conversation.value.at(-1));
const inputCollapsed = ref(false),
	outputCollapsed = ref(false);
const hasMeta = computed(
	() =>
		meta.value.reasoningEffort !== undefined ||
		meta.value.thinkingBudget !== undefined ||
		meta.value.tools.length ||
		meta.value.temperature !== undefined ||
		meta.value.topP !== undefined ||
		meta.value.maxTokens !== undefined ||
		meta.value.stream !== undefined,
);
</script>
<template>
	<PrettyRealtimeComponent v-if="isRealtimeResponse(response)" :response="response" :metrics="metrics" />
	<div v-else>
		<div v-if="hasMeta" class="pretty-meta-tags">
			<UiTag v-if="meta.stream" color="geekblue">streaming</UiTag
			><UiTag v-if="meta.reasoningEffort !== undefined" color="purple">Reasoning: {{ meta.reasoningEffort }}</UiTag
			><UiTag v-if="meta.thinkingBudget !== undefined" color="purple">Thinking budget: {{ meta.thinkingBudget }} tokens</UiTag
			><UiTag v-if="meta.tools.length" color="blue"
				>Tools:
				{{
					meta.tools
						.slice(0, 3)
						.map((tool) => tool.name)
						.join(", ")
				}}{{ meta.tools.length > 3 ? " +" + (meta.tools.length - 3) : "" }}</UiTag
			><UiTag v-if="meta.temperature !== undefined">temperature: {{ meta.temperature }}</UiTag
			><UiTag v-if="meta.topP !== undefined">top_p: {{ meta.topP }}</UiTag
			><UiTag v-if="meta.maxTokens !== undefined">max_tokens: {{ meta.maxTokens }}</UiTag>
		</div>
		<div v-if="messages.length || meta.tools.length" class="pretty-card pretty-card--input">
			<PrettySectionHeaderComponent
				type="input"
				:tokens="metrics?.prompt_tokens"
				:cost="metrics?.input_cost"
				:collapsed="inputCollapsed"
				@toggle="inputCollapsed = !inputCollapsed"
				@copy="copyDetail(last?.content || '', 'Input copied')"
			/>
			<div class="pretty-card__animation" :style="{ maxHeight: inputCollapsed ? '0px' : '10000px', opacity: inputCollapsed ? 0 : 1 }">
				<div class="pretty-card__body">
					<PrettyCollapsibleComponent v-if="system?.content" :default-open="system.content.length < 200"
						><template #label
							><span class="pretty-label">SYSTEM</span
							><span class="pretty-label">({{ system.content.length.toLocaleString() }} chars)</span></template
						>
						<div class="pretty-text">{{ system.content }}</div></PrettyCollapsibleComponent
					>
					<PrettyCollapsibleComponent
						v-if="history.length"
						:label="'HISTORY (' + history.length + ' message' + (history.length === 1 ? '' : 's') + ')'"
						><PrettySimpleMessageComponent
							v-for="(message, index) in history"
							:key="index"
							:label="message.role.toUpperCase()"
							:content="message.content"
							:tool-calls="message.toolCalls"
							:parts="message.parts"
							compact
					/></PrettyCollapsibleComponent>
					<PrettyInputToolsComponent :tools="meta.tools" /><PrettySimpleMessageComponent
						v-if="last"
						:label="last.role.toUpperCase()"
						:content="last.content"
						:tool-calls="last.toolCalls"
						:parts="last.parts"
					/>
				</div>
			</div>
		</div>
		<div class="pretty-card">
			<PrettySectionHeaderComponent
				type="output"
				:tokens="metrics?.completion_tokens"
				:cost="metrics?.output_cost"
				:collapsed="outputCollapsed"
				@toggle="outputCollapsed = !outputCollapsed"
				@copy="responseMessage && copyDetail(responseMessage.content || '', 'Output copied')"
			/>
			<div
				class="pretty-card__animation"
				:style="{ maxHeight: outputCollapsed ? '0px' : '10000px', opacity: outputCollapsed ? 0 : 1 }"
			>
				<div class="pretty-card__body">
					<PrettySimpleMessageComponent
						v-if="responseMessage"
						label="ASSISTANT"
						:content="responseMessage.content"
						:tool-calls="responseMessage.toolCalls"
						:parts="responseMessage.parts"
					/><span v-else class="ld-secondary" style="font-size: 13px; font-style: italic">No response data available</span>
				</div>
			</div>
		</div>
	</div>
</template>
