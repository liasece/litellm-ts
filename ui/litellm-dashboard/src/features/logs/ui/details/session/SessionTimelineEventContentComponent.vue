<script setup lang="ts">
import { computed } from "vue";
import type { SessionTimelineEvent } from "../../../support/SessionTimelineModels";
import { parseUserContextPrefixes } from "../../../logic/SessionTimelineContentLogic";
import { isMissingSpendLogBlockRef } from "../../../logic/spendLogBlockRefs";
import PrettyMessagePartsComponent from "../PrettyMessagePartsComponent.vue";
import SessionTimelineToolResultComponent from "./SessionTimelineToolResultComponent.vue";
import SessionTimelineUserContentComponent from "./SessionTimelineUserContentComponent.vue";
import PrivacyPlaceholderText from "../../../../content/ui/PrivacyPlaceholderText.vue";
const props = defineProps<{ item: SessionTimelineEvent }>();
const context = computed(() => (props.item.role === "user" ? parseUserContextPrefixes(props.item.content) : null));
const nonText = computed(() => (props.item.parts ?? []).filter((part) => part.kind !== "text"));
const isSerializedMissingBlockRef = (content: string): boolean => {
	const trimmed = content.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
	try {
		return isMissingSpendLogBlockRef(JSON.parse(trimmed));
	} catch {
		return false;
	}
};
/**
 * 时间线事件是否只承载一个缺块占位。
 *
 * 服务端解析过的缺块会变成 `data` 里带占位对象的未知内容块；只保留 `content`
 * 的事件则是序列化后的占位 JSON。两种情况都不应把占位对象原样展示给用户。
 */
const missingBlockRef = computed(
	() => (props.item.parts ?? []).some((part) => isMissingSpendLogBlockRef(part.data)) || isSerializedMissingBlockRef(props.item.content),
);
</script>
<template>
	<div v-if="missingBlockRef" class="session-timeline__block-ref-missing">该条内容在日志块存储中已不可用</div>
	<SessionTimelineToolResultComponent v-else-if="item.role === 'tool'" :item="item" />
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
