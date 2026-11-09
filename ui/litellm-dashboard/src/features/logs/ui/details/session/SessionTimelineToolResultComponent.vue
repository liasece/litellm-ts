<script setup lang="ts">
import { computed, ref } from "vue";
import type { SessionTimelineEvent } from "../../../support/SessionTimelineModels";
import { safeJsonStringify } from "../../../logic/PrettyMessagesBlocksLogic";
import UiLucideIcon from "../../../../platform/ui/UiLucideIcon.vue";
import PrettyMessagePartsComponent from "../PrettyMessagePartsComponent.vue";
import PrivacyPlaceholderText from "../../../../content/ui/PrivacyPlaceholderText.vue";
const props = defineProps<{ item: SessionTimelineEvent }>();
const expanded = ref(false),
	result = computed(() => props.item.parts?.find((part) => part.kind === "tool_result")),
	name = computed(() => result.value?.name?.trim() || "未命名工具");
const detail = computed(
	() =>
		result.value?.text ||
		(result.value?.data !== undefined ? safeJsonStringify(result.value.data, true) : props.item.content || "（空输出）"),
);
const failed = computed(
	() =>
		result.value?.isError === true ||
		["error", "failed", "failure"].includes(String(result.value?.status ?? props.item.status ?? "").toLowerCase()),
);
</script>
<template>
	<section class="session-tool-result" :class="{ 'session-tool-result--error': failed }" :aria-label="'工具结果 ' + name">
		<button
			type="button"
			:aria-expanded="expanded"
			:aria-label="(expanded ? '收起' : '展开') + '工具结果 ' + name"
			@click="expanded = !expanded"
		>
			<span class="session-tool-result__icon"><UiLucideIcon name="Terminal" :size="15" /></span
			><span class="session-tool-result__summary"
				><span
					><strong>{{ name }}</strong
					><span class="session-tool-result__status">{{ failed ? "执行失败" : result?.status || "已返回" }}</span></span
				><span class="session-tool-result__preview"
					><PrivacyPlaceholderText :text="detail.replace(/\s+/g, ' ').trim() || '（空输出）'" /></span></span
			><span class="session-tool-result__control">{{ expanded ? "收起" : "展开" }}</span
			><UiLucideIcon name="ChevronDown" :size="15" :style="{ transform: expanded ? 'rotate(180deg)' : undefined }" />
		</button>
		<div v-if="expanded" role="region" :aria-label="'工具结果全文 ' + name" class="session-tool-result__body">
			<div class="session-tool-result__meta">
				<span>{{ detail.length.toLocaleString("zh-CN") }} 字符</span
				><span v-if="result?.id" class="ld-mono ld-truncate">{{ result.id }}</span>
			</div>
			<div v-if="result?.parts?.length" class="session-tool-result__structured">
				<PrettyMessagePartsComponent :parts="result.parts" :image-sources="item.image_sources" />
			</div>
			<pre v-else><PrivacyPlaceholderText :text="detail" /></pre>
		</div>
	</section>
</template>
