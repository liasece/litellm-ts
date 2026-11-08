<script setup lang="ts">
import { computed, ref } from "vue";
import type { UserContextBlock } from "../../../logic/SessionTimelineContentLogic";
import { parseTranscriptEntries } from "../../../logic/SessionTimelineContentLogic";
import UiLucideIcon from "../../../../platform/ui/UiLucideIcon.vue";
import SessionTimelineUserContentComponent from "./SessionTimelineUserContentComponent.vue";
const props = defineProps<{ block: UserContextBlock }>();
const expanded = ref(false);
const entries = computed(() => (props.block.kind === "transcript" ? parseTranscriptEntries(props.block.content) : []));
const preview = computed(() => {
	if (props.block.kind === "ide_opened_file") return "";
	if (props.block.kind === "system_reminder") return props.block.content.replace(/\s+/g, " ").trim() || "（空内容）";
	const entry = entries.value[0];
	return entry
		? (entry.kind === "tool" ? (entry.toolName ?? entry.label) : entry.label) +
				" · " +
				(entry.content.replace(/\s+/g, " ").trim() || "（空内容）")
		: "（空转录）";
});
</script>
<template>
	<div v-if="block.kind === 'ide_opened_file'" class="session-context-file">
		<div class="session-context-file__header">
			<span class="session-context-icon"><UiLucideIcon name="FileCode2" :size="14" /></span><span>IDE 已打开文件</span
			><span v-if="block.context.path?.split(/[\\/]/).filter(Boolean).at(-1)" class="session-context-file__name">{{
				block.context.path.split(/[\\/]/).filter(Boolean).at(-1)
			}}</span>
		</div>
		<div class="session-context-file__path">{{ block.context.path ?? block.context.description }}</div>
	</div>
	<section
		v-else
		class="session-context-disclosure"
		:class="block.kind === 'system_reminder' ? 'session-context-reminder' : 'session-context-transcript'"
		:aria-label="block.kind === 'transcript' ? '会话转录' : undefined"
	>
		<button
			type="button"
			:aria-expanded="expanded"
			:aria-label="(expanded ? '收起' : '展开') + (block.kind === 'system_reminder' ? '系统提醒' : '会话转录')"
			@click="expanded = !expanded"
		>
			<span class="session-context-icon"
				><UiLucideIcon :name="block.kind === 'system_reminder' ? 'BellRing' : 'ScrollText'" :size="14" /></span
			><strong>{{ block.kind === "system_reminder" ? "系统提醒" : "会话转录" }}</strong
			><span v-if="block.kind === 'transcript'" class="session-context-count">{{ entries.length }} 条记录</span
			><span class="session-context-preview">{{ preview }}</span
			><span class="session-context-control">{{ expanded ? "收起" : "展开" }}</span
			><UiLucideIcon name="ChevronDown" :size="14" :style="{ transform: expanded ? 'rotate(180deg)' : undefined }" />
		</button>
		<div
			v-if="expanded"
			role="region"
			:aria-label="block.kind === 'system_reminder' ? '系统提醒全文' : '会话转录全文'"
			class="session-context-disclosure__body"
		>
			<div v-if="block.kind === 'system_reminder'" class="session-context-reminder__text">{{ block.content || "（空内容）" }}</div>
			<template v-else
				><div
					v-for="(entry, index) in entries"
					:key="entry.kind + '-' + index"
					class="session-transcript-entry"
					:class="'session-transcript-entry--' + entry.kind"
				>
					<template v-if="entry.kind === 'tool'"
						><span class="session-transcript-tool-icon"><UiLucideIcon name="Terminal" :size="12" /></span
						><span class="session-transcript-badge">{{ entry.toolName ?? entry.label }}</span
						><code>{{ entry.content || "（空内容）" }}</code></template
					><template v-else
						><div class="session-transcript-entry__label">
							<span class="session-transcript-badge">{{ entry.label }}</span>
						</div>
						<SessionTimelineUserContentComponent v-if="entry.kind === 'user'" :content="entry.content" />
						<div v-else class="session-transcript-entry__text">{{ entry.content || "（空内容）" }}</div></template
					>
				</div>
				<div v-if="!entries.length" class="session-transcript-empty">（空转录）</div></template
			>
		</div>
	</section>
</template>
