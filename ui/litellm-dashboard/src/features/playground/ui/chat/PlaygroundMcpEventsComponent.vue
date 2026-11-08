<script setup lang="ts">
import { computed } from "vue";
import type { PlaygroundEvent } from "../../support/PlaygroundModels";
import { asRecord, records, json } from "../../logic/PlaygroundValueLogic";
import UiIcon from "../../../platform/ui/UiIcon.vue";
const props = defineProps<{ events: PlaygroundEvent[] }>();
const tools = computed(() =>
	props.events.find(
		(event) => event.type === "response.output_item.done" && event.item?.type === "mcp_list_tools" && records(event.item.tools).length,
	),
);
const calls = computed(() => props.events.filter((event) => event.type === "response.output_item.done" && event.item?.type === "mcp_call"));
function format(value: unknown) {
	if (typeof value !== "string") return json(value, true);
	try {
		return json(JSON.parse(value), true);
	} catch {
		return value;
	}
}
function output(value: unknown) {
	return typeof value === "string" ? value : json(value, true);
}
</script>
<template>
	<div v-if="tools || calls.length" class="pg-mcp-events">
		<details v-if="tools" open>
			<summary><UiIcon name="RightOutlined" />List tools</summary>
			<div class="pg-mcp-events__body">
				<div v-for="(tool, index) in records(tools.item?.tools)" :key="index" class="pg-mono">{{ tool.name }}</div>
			</div>
		</details>
		<details v-for="(event, index) in calls" :key="String(event.item?.id || index)" :open="!tools">
			<summary><UiIcon name="RightOutlined" />{{ event.item?.name || "Tool call" }}</summary>
			<div class="pg-mcp-events__body">
				<section>
					<strong>Request</strong>
					<pre>{{ format(event.item?.arguments) }}</pre>
				</section>
				<section><span class="pg-mcp-events__approved">✓</span> Approved</section>
				<section v-if="event.item?.output">
					<strong>Response</strong>
					<div class="pg-mono pg-pre">{{ output(asRecord(event.item)?.output) }}</div>
				</section>
			</div>
		</details>
	</div>
</template>
