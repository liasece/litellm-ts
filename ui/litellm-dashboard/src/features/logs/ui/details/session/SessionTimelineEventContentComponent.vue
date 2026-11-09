<script setup lang="ts">
import { computed } from "vue";
import type { SessionTimelineEvent } from "../../../support/SessionTimelineModels";
import { parseUserContextPrefixes } from "../../../logic/SessionTimelineContentLogic";
import PrettyMessagePartsComponent from "../PrettyMessagePartsComponent.vue";
import SessionTimelineToolResultComponent from "./SessionTimelineToolResultComponent.vue";
import SessionTimelineUserContentComponent from "./SessionTimelineUserContentComponent.vue";
import PrivacyPlaceholderText from "../../../../content/ui/PrivacyPlaceholderText.vue";
const props = defineProps<{ item: SessionTimelineEvent }>();
const context = computed(() => (props.item.role === "user" ? parseUserContextPrefixes(props.item.content) : null));
const nonText = computed(() => (props.item.parts ?? []).filter((part) => part.kind !== "text"));
</script>
<template>
	<SessionTimelineToolResultComponent v-if="item.role === 'tool'" :item="item" />
	<div v-else-if="context?.blocks.length" class="session-user-context">
		<SessionTimelineUserContentComponent :content="item.content" /><PrettyMessagePartsComponent
			v-if="nonText.length"
			:parts="nonText"
			:image-sources="item.image_sources"
		/>
	</div>
	<PrettyMessagePartsComponent v-else-if="item.parts?.length" :parts="item.parts" :image-sources="item.image_sources" />
	<div v-else class="session-user-text"><PrivacyPlaceholderText :text="item.content || '（空内容）'" /></div>
</template>
