<script setup lang="ts">
import { computed } from "vue";
import { copyText } from "../../../content/logic/ClipboardLogic";
import type { PlaygroundHistoryStore } from "../../stores/PlaygroundHistoryStore";
import { notify } from "../../logic/PlaygroundValueLogic";
import UiSwitch from "../../../platform/ui/UiSwitch.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
const props = defineProps<{ history: PlaygroundHistoryStore }>();
const slash = String.fromCharCode(92);
const sessionExample = computed(() =>
	[
		'curl -X POST "your-proxy-url/v1/responses" ' + slash,
		'  -H "Authorization: Bearer your-api-key" ' + slash,
		'  -H "Content-Type: application/json" ' + slash,
		"  -d '{",
		'    "model": "your-model",',
		'    "input": [{"role": "user", "content": "your message", "type": "message"}],',
		'    "previous_response_id": ' + JSON.stringify(props.history.state.responseId) + ",",
		'    "stream": true',
		"  }'",
	].join("\n"),
);

async function copy() {
	if (!props.history.state.responseId) return;
	try {
		await copyText(props.history.state.responseId);
		notify("success", "Response ID copied to clipboard!");
	} catch {
		// copyText 已提示失败。
	}
}
</script>
<template>
	<div class="pg-session">
		<div class="pg-between pg-session__heading">
			<span
				>Session Management
				<UiTooltip
					title="Choose between LiteLLM API session management (using previous_response_id) or UI-based session management (using chat history)"
					><UiIcon name="InfoCircleOutlined" :size="12" /></UiTooltip></span
			><UiSwitch
				:model-value="history.state.useApiSession"
				size="small"
				label="Use API session management"
				@update:model-value="history.toggleSession"
				>{{ history.state.useApiSession ? "API" : "UI" }}</UiSwitch
			>
		</div>
		<div class="pg-session__status" :class="{ 'pg-session__status--active': history.state.responseId }">
			<div class="pg-between">
				<span class="pg-inline"
					><UiIcon name="InfoCircleOutlined" :size="12" />{{
						history.state.responseId
							? (history.state.useApiSession ? "Response ID" : "UI Session") +
								": " +
								history.state.responseId.slice(0, 10) +
								"..."
							: history.state.useApiSession
								? "API Session: Ready"
								: "UI Session: Ready"
					}}</span
				>
				<UiTooltip
					v-if="history.state.responseId"
					popup-class="pg-session-copy-popup"
					title="Copy response ID to continue session:"
				>
					<button type="button" aria-label="Copy response ID" @click="copy"><UiIcon name="CopyOutlined" :size="12" /></button>
					<template #content
						><div class="pg-session-copy-tooltip">
							<div>Copy response ID to continue session:</div>
							<pre>{{ sessionExample }}</pre>
						</div></template
					>
				</UiTooltip>
			</div>
			<div>
				{{
					history.state.responseId
						? history.state.useApiSession
							? "LiteLLM API session active - context maintained server-side"
							: "UI session active - context maintained client-side"
						: history.state.useApiSession
							? "LiteLLM will manage session using previous_response_id"
							: "UI will manage session using chat history"
				}}
			</div>
		</div>
	</div>
</template>
