<script setup lang="ts">
import { computed, ref } from "vue";
import { asRecord, json } from "../../logic/PlaygroundValueLogic";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
const props = defineProps<{ metadata?: Record<string, unknown>; timeToFirstToken?: number; totalLatency?: number }>(),
	expanded = ref(false);
const status = computed(() => asRecord(props.metadata?.status)),
	state = computed(() => String(status.value?.state || "")),
	extra = computed(() => asRecord(props.metadata?.metadata));
const icon = computed(() =>
	state.value === "completed"
		? "CheckCircleOutlined"
		: ["working", "submitted"].includes(state.value)
			? "LoadingOutlined"
			: ["failed", "canceled"].includes(state.value)
				? "ExclamationCircleOutlined"
				: "ClockCircleOutlined",
);
function truncate(value: unknown) {
	const text = String(value);
	return text.length > 8 ? text.slice(0, 8) + "…" : text;
}
function copy(value: unknown) {
	return navigator.clipboard.writeText(String(value));
}
function time(value: unknown) {
	if (typeof value !== "string") return "";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
</script>
<template>
	<div v-if="metadata || timeToFirstToken !== undefined || totalLatency !== undefined" class="pg-a2a">
		<div class="pg-a2a__title"><UiIcon name="RobotOutlined" /> A2A Metadata</div>
		<div class="pg-a2a__row">
			<span v-if="state" class="pg-a2a__status" :class="'pg-a2a__status--' + state"><UiIcon :name="icon" />{{ state }}</span
			><UiTooltip v-if="status?.timestamp" :title="String(status.timestamp)"
				><span><UiIcon name="ClockCircleOutlined" />{{ time(status.timestamp) }}</span></UiTooltip
			><UiTooltip v-if="totalLatency !== undefined" title="Total latency"
				><span class="pg-blue"><UiIcon name="ClockCircleOutlined" />{{ (totalLatency / 1000).toFixed(2) }}s</span></UiTooltip
			><UiTooltip v-if="timeToFirstToken !== undefined" title="Time to first token"
				><span class="pg-green">TTFT: {{ (timeToFirstToken / 1000).toFixed(2) }}s</span></UiTooltip
			>
		</div>
		<div class="pg-a2a__row pg-mt-8">
			<UiTooltip v-if="metadata?.taskId" :title="'Click to copy: ' + metadata.taskId"
				><button type="button" @click="copy(metadata.taskId)">
					<UiIcon name="FileTextOutlined" /> Task: {{ truncate(metadata.taskId)
					}}<UiIcon name="CopyOutlined" /></button></UiTooltip
			><UiTooltip v-if="metadata?.contextId" :title="'Click to copy: ' + metadata.contextId"
				><button type="button" @click="copy(metadata.contextId)">
					<UiIcon name="LinkOutlined" /> Session: {{ truncate(metadata.contextId)
					}}<UiIcon name="CopyOutlined" /></button></UiTooltip
			><button v-if="extra || status?.message" type="button" class="pg-blue" @click="expanded = !expanded">
				<UiIcon :name="expanded ? 'DownOutlined' : 'RightOutlined'" /> Details
			</button>
		</div>
		<div v-if="expanded" class="pg-a2a__details">
			<p v-if="status?.message"><strong>Status Message:</strong> {{ status.message }}</p>
			<p v-for="field in ['taskId', 'contextId']" :key="field">
				<template v-if="metadata?.[field]"
					><strong>{{ field === "taskId" ? "Task ID:" : "Session ID:" }}</strong
					><code>{{ metadata[field] }}</code
					><button type="button" :aria-label="'Copy ' + field" @click="copy(metadata[field])">
						<UiIcon name="CopyOutlined" /></button
				></template>
			</p>
			<template v-if="extra && Object.keys(extra).length"
				><strong>Custom Metadata:</strong>
				<pre>{{ json(extra, true) }}</pre>
			</template>
		</div>
	</div>
</template>
