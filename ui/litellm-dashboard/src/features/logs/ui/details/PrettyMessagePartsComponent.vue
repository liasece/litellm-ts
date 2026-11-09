<script setup lang="ts">
import { computed } from "vue";
import type { MessagePart } from "../../support/PrettyMessagesModels";
import { asRecord, safeJsonStringify } from "../../logic/PrettyMessagesBlocksLogic";
import MarkdownContent from "../../../content/ui/MarkdownContent.vue";
import MarkdownImageComponent from "../../../content/ui/MarkdownImageComponent.vue";
import PrettySimpleToolCallComponent from "./PrettySimpleToolCallComponent.vue";
import PrivacyPlaceholderText from "../../../content/ui/PrivacyPlaceholderText.vue";
const props = withDefaults(defineProps<{ parts: MessagePart[]; compact?: boolean; imageSources?: Readonly<Record<string, string>> }>(), {
	compact: false,
	imageSources: undefined,
});
const tones: Record<string, { background: string; border: string; color: string }> = {
	thinking: { background: "#faf5ff", border: "#e9d5ff", color: "#7e22ce" },
	redacted_thinking: { background: "#fafafa", border: "#e5e7eb", color: "#6b7280" },
	tool_result: { background: "#fff7ed", border: "#fed7aa", color: "#c2410c" },
	web_search: { background: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8" },
	file_search: { background: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8" },
	computer: { background: "#f0fdfa", border: "#99f6e4", color: "#0f766e" },
	code: { background: "#f8fafc", border: "#cbd5e1", color: "#334155" },
	code_result: { background: "#f8fafc", border: "#cbd5e1", color: "#334155" },
	image: { background: "#f8fafc", border: "#e2e8f0", color: "#475569" },
	document: { background: "#f8fafc", border: "#e2e8f0", color: "#475569" },
	audio: { background: "#f8fafc", border: "#e2e8f0", color: "#475569" },
	refusal: { background: "#fef2f2", border: "#fecaca", color: "#b91c1c" },
	unknown: { background: "#fffbeb", border: "#fde68a", color: "#92400e" },
};
const displayed = computed(() => {
	const paired = new Set<number>(),
		results = new Map<number, MessagePart>();
	props.parts.forEach((part, index) => {
		if (part.kind !== "tool_call" || !part.id) return;
		const match = props.parts.findIndex(
			(candidate, i) => !paired.has(i) && candidate.kind === "tool_result" && candidate.id === part.id,
		);
		if (match >= 0) {
			paired.add(match);
			results.set(index, props.parts[match]);
		}
	});
	return props.parts.flatMap((part, index) => (paired.has(index) ? [] : [{ part, index, result: results.get(index) }]));
});
function imageSource(part: MessagePart) {
	const record = asRecord(part.data),
		candidate = typeof record?.src === "string" ? record.src : part.text;
	return typeof candidate === "string" &&
		!candidate.includes("litellm_truncated") &&
		/^(?:data:image\/(?:png|jpe?g|webp|gif);base64,|https?:\/\/)/i.test(candidate)
		? candidate
		: undefined;
}
function detail(part: MessagePart) {
	return part.kind === "image" && (asRecord(part.data)?.truncated === true || part.text?.includes("litellm_truncated"))
		? "图片数据在日志入库时被截断，无法显示。"
		: part.text || (part.data !== undefined ? safeJsonStringify(part.data, true) : "");
}
function operationStyle(part: MessagePart) {
	const tone = tones[part.kind] ?? tones.unknown;
	return { background: tone.background, borderColor: tone.border, color: tone.color, padding: props.compact ? "7px 10px" : "10px 12px" };
}
</script>
<template>
	<div class="pretty-parts">
		<template v-for="{ part, index, result } in displayed" :key="part.kind + '-' + (part.id || index)">
			<div
				v-if="part.kind === 'text'"
				class="pretty-text pretty-message-markdown"
				data-message-part="text"
				:style="{ marginTop: index === 0 ? 0 : '8px' }"
			>
				<MarkdownContent :source="part.text || ''" :image-sources="imageSources" image-preview local-image-fallback />
			</div>
			<PrettySimpleToolCallComponent
				v-else-if="part.kind === 'tool_call'"
				:tool="{ id: part.id || '', name: part.name || 'unknown', arguments: asRecord(part.data) || { raw: part.data } }"
				:compact="compact"
				:badge="part.label"
				:result="result"
				><template v-if="result?.parts?.length" #result
					><PrettyMessagePartsComponent :parts="result.parts" :compact="compact" :image-sources="imageSources" /></template
			></PrettySimpleToolCallComponent>
			<div v-else class="pretty-operation" :data-message-part="part.kind" :style="operationStyle(part)">
				<div class="pretty-operation__header" :style="{ marginBottom: detail(part) || part.parts?.length ? '6px' : 0 }">
					<strong>{{ part.label }}</strong
					><span v-if="part.name" class="pretty-operation__name">{{ part.name }}</span
					><span v-if="part.status" class="pretty-operation__status" :class="{ 'ld-danger': part.isError }">{{
						part.status
					}}</span
					><span v-if="part.id" class="pretty-operation__id">{{ part.id }}</span>
				</div>
				<template v-if="part.kind === 'image' && imageSource(part)"
					><MarkdownImageComponent
						:src="imageSource(part)"
						:alt="part.text !== imageSource(part) ? part.text : part.label || 'Generated image'"
						preview
						:style="{ maxHeight: compact ? '360px' : '640px' }" />
					<div v-if="part.text && part.text !== imageSource(part)" class="pretty-operation__caption">
						<MarkdownContent :source="part.text" :image-sources="imageSources" image-preview local-image-fallback /></div
				></template>
				<PrettyMessagePartsComponent
					v-else-if="part.parts?.length"
					:parts="part.parts"
					:compact="compact"
					:image-sources="imageSources"
				/>
				<div
					v-else-if="detail(part) && (part.kind === 'thinking' || part.kind === 'refusal')"
					class="pretty-operation__markdown pretty-message-markdown"
				>
					<MarkdownContent :source="detail(part)" :image-sources="imageSources" image-preview local-image-fallback />
				</div>
				<pre
					v-else-if="detail(part)"
					:style="{ maxHeight: compact ? '180px' : '320px' }"
				><PrivacyPlaceholderText :text="detail(part)" /></pre>
			</div>
		</template>
	</div>
</template>
