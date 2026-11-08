<script setup lang="ts">
import { copyHubText } from "../../logic/ModelHubClipboardLogic";
defineProps<{ title: string; code: string; compact?: boolean }>();
</script>
<template>
	<div class="hub-code-example" :class="{ 'hub-code-example--compact': compact }">
		<h3>{{ title }}</h3>
		<div>
			<pre>{{ code }}</pre>
		</div>
		<p><button type="button" @click="copyHubText(code)">Copy to clipboard</button></p>
	</div>
</template>
<style>
.hub-code-example > h3 {
	font-size: 18px;
	font-weight: 600;
	line-height: 28px;
	margin: 0 0 16px;
	color: #6b7280;
}
.hub-code-example > div {
	overflow-x: auto;
	border-radius: 8px;
	background: #111827;
	color: #f3f4f6;
	padding: 16px;
}
.hub-code-example pre {
	margin: 0;
	font: 14px/20px var(--ui-font-mono);
	white-space: pre;
}
.hub-code-example > p {
	text-align: right;
	margin: 8px 0 0;
}
.hub-code-example button {
	background: none;
	border: 0;
	padding: 0;
	color: #2563eb;
	font-size: 14px;
	line-height: 20px;
	cursor: pointer;
}
.hub-code-example button:hover {
	color: #1e40af;
}
.hub-code-example--compact > h3 {
	font-size: 14px;
	line-height: 20px;
	font-weight: 500;
	margin-bottom: 8px;
	color: #374151;
}
.hub-code-example--compact pre {
	font-size: 12px;
	line-height: 16px;
}
</style>
