<script setup lang="ts">
import { reactive } from "vue";
import type { RequestTool } from "../../support/PrettyMessagesModels";
import { safeJsonStringify } from "../../logic/PrettyMessagesBlocksLogic";
import PrettyCollapsibleComponent from "./PrettyCollapsibleComponent.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
defineProps<{ tools: RequestTool[] }>();
const expanded = reactive(new Set<number>());
function toggle(index: number) {
	if (expanded.has(index)) expanded.delete(index);
	else expanded.add(index);
}
</script>
<template>
	<PrettyCollapsibleComponent v-if="tools.length" :label="'TOOLS (' + tools.length + ')'" lazy class="pretty-tools"
		><div v-for="(tool, index) in tools" :key="tool.name + '-' + index" class="pretty-tools__card">
			<button type="button" class="pretty-tools__toggle" :aria-expanded="expanded.has(index)" @click="toggle(index)">
				<UiIcon :name="expanded.has(index) ? 'DownOutlined' : 'RightOutlined'" /><strong>{{ index + 1 }}. {{ tool.name }}</strong
				><UiTag v-if="tool.type !== 'function'">{{ tool.type }}</UiTag>
			</button>
			<div v-if="expanded.has(index)" class="pretty-tools__definition">
				<div v-if="tool.description" class="pretty-tools__description">{{ tool.description }}</div>
				<div v-if="tool.parameters !== undefined" class="pretty-tools__json">
					<span>Parameters</span>
					<pre>{{ safeJsonStringify(tool.parameters, true) }}</pre>
				</div>
				<div v-if="tool.extra" class="pretty-tools__json">
					<span>Other fields</span>
					<pre>{{ safeJsonStringify(tool.extra, true) }}</pre>
				</div>
			</div>
		</div></PrettyCollapsibleComponent
	>
</template>
