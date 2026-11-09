<script setup lang="ts">
import { computed } from "vue";
import { parseUserContextPrefixes } from "../../../logic/SessionTimelineContentLogic";
import SessionTimelineContextBlockComponent from "./SessionTimelineContextBlockComponent.vue";
import PrivacyPlaceholderText from "../../../../content/ui/PrivacyPlaceholderText.vue";
const props = defineProps<{ content: string }>();
const parsed = computed(() => parseUserContextPrefixes(props.content));
</script>
<template>
	<div v-if="parsed.blocks.length" class="session-user-context">
		<SessionTimelineContextBlockComponent v-for="(block, index) in parsed.blocks" :key="block.kind + '-' + index" :block="block" />
		<div v-if="parsed.remainingContent" class="session-user-text">
			<PrivacyPlaceholderText :text="parsed.remainingContent" />
		</div>
	</div>
	<div v-else class="session-user-text"><PrivacyPlaceholderText :text="content" /></div>
</template>
