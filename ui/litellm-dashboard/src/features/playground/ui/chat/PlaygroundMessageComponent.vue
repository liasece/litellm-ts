<script setup lang="ts">
import { computed, ref } from "vue";
import type { CodeInterpreterResult, EndpointType, PlaygroundEvent, PlaygroundMessage } from "../../support/PlaygroundModels";
import { json } from "../../logic/PlaygroundValueLogic";
import MarkdownContent from "../../../content/ui/MarkdownContent.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import PlaygroundMcpEventsComponent from "./PlaygroundMcpEventsComponent.vue";
import PlaygroundSearchResultsComponent from "./PlaygroundSearchResultsComponent.vue";
import PlaygroundA2AMetricsComponent from "./PlaygroundA2AMetricsComponent.vue";
import PlaygroundResponseMetricsComponent from "./PlaygroundResponseMetricsComponent.vue";
import PlaygroundCodeOutputComponent from "./PlaygroundCodeOutputComponent.vue";
const props = defineProps<{
		message: PlaygroundMessage;
		last: boolean;
		endpoint: EndpointType;
		events: PlaygroundEvent[];
		codeResult?: CodeInterpreterResult | null;
	}>(),
	reasoning = ref(true);
const text = computed(() => (typeof props.message.content === "string" ? props.message.content : json(props.message.content, true))),
	assistant = computed(() => props.message.role === "assistant");
</script>
<template>
	<article class="pg-message" :class="{ 'pg-message--user': message.role === 'user' }">
		<div class="pg-message__bubble">
			<div class="pg-message__heading">
				<span class="pg-message__avatar"><UiIcon :name="message.role === 'user' ? 'UserOutlined' : 'RobotOutlined'" /></span
				><strong>{{ message.role }}</strong
				><span v-if="assistant && message.model" class="pg-message__model">{{ message.model }}</span>
			</div>
			<div v-if="message.reasoningContent" class="pg-message__reasoning">
				<UiButton variant="text" @click="reasoning = !reasoning"
					><template #icon><UiIcon name="BulbOutlined" /></template>{{ reasoning ? "Hide reasoning" : "Show reasoning"
					}}<UiIcon :name="reasoning ? 'DownOutlined' : 'RightOutlined'"
				/></UiButton>
				<div v-if="reasoning" class="pg-message__reasoning-text">
					<MarkdownContent :source="message.reasoningContent" :gfm="false" highlight-code />
				</div>
			</div>
			<PlaygroundMcpEventsComponent
				v-if="assistant && last && ['chat', 'responses'].includes(endpoint)"
				:events="events"
			/><PlaygroundSearchResultsComponent
				v-if="message.searchResults?.length"
				:results="message.searchResults"
			/><PlaygroundCodeOutputComponent v-if="assistant && last && endpoint === 'responses' && codeResult" :result="codeResult" />
			<div class="pg-message__content">
				<img v-if="message.isImage" :src="text" alt="Generated image" class="pg-message__image" />
				<div v-else-if="message.isAudio" class="pg-message__audio">
					<audio :src="text" controls>Your browser does not support the audio element.</audio>
				</div>
				<template v-else
					><img
						v-if="message.imagePreviewUrl && ['chat', 'responses'].includes(endpoint) && /\[(Image|PDF) attached\]/.test(text)"
						:src="message.imagePreviewUrl"
						alt="Uploaded image"
						class="pg-message__image" /><MarkdownContent :source="text" :gfm="false" highlight-code wrap-code-lines /><img
						v-if="message.image"
						:src="message.image.url"
						alt="Generated image"
						class="pg-message__image pg-mt-12"
				/></template>
			</div>
			<PlaygroundA2AMetricsComponent
				v-if="assistant && message.a2aMetadata"
				:metadata="message.a2aMetadata"
				:time-to-first-token="message.timeToFirstToken"
				:total-latency="message.totalLatency"
			/>
			<PlaygroundResponseMetricsComponent
				v-else-if="assistant"
				:model="message.model"
				:time-to-first-token="message.timeToFirstToken"
				:total-latency="message.totalLatency"
				:usage="message.usage"
				:tool-name="message.toolName"
			/>
		</div>
	</article>
</template>
