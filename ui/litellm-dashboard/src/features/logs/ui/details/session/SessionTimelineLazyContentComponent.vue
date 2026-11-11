<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { SessionTimelineEvent } from "../../../support/SessionTimelineModels";
import PrivacyPlaceholderText from "../../../../content/ui/PrivacyPlaceholderText.vue";
import SessionTimelineEventContentComponent from "./SessionTimelineEventContentComponent.vue";
const props = defineProps<{ item: SessionTimelineEvent }>();
const host = ref<HTMLElement | null>(null);
const visible = ref(false);
let observer: IntersectionObserver | null = null;
/**
 * 未挂载时的纯文本摘要。
 *
 * Markdown 解析是长会话首屏的主要开销，摘要只取前 240 个字符，避免为屏外事件解析完整内容。
 */
const preview = computed(() => {
	const text = (props.item.content || "").replace(/\s+/g, " ").trim();
	return text.length > 240 ? `${text.slice(0, 240)}…` : text || "（空内容）";
});
onMounted(() => {
	if (typeof IntersectionObserver === "undefined") {
		visible.value = true;
		return;
	}
	observer = new IntersectionObserver(
		(entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			visible.value = true;
			observer?.disconnect();
			observer = null;
		},
		{ rootMargin: "400px 0px" },
	);
	if (host.value) observer.observe(host.value);
});
onBeforeUnmount(() => {
	observer?.disconnect();
	observer = null;
});
</script>
<template>
	<div ref="host">
		<SessionTimelineEventContentComponent v-if="visible" :item="item" />
		<div v-else class="session-timeline__lazy-preview"><PrivacyPlaceholderText :text="preview" /></div>
	</div>
</template>
