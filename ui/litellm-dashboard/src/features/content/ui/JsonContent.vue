<script setup lang="ts">
import { ref } from "vue";
import JsonTreeNode from "./JsonTreeNode.vue";
import "./JsonContentStyles.css";
withDefaults(defineProps<{ value: unknown; maxHeight?: number | string; framed?: boolean; expanded?: boolean; emptyText?: string }>(), {
	maxHeight: 400,
	framed: true,
	expanded: true,
	emptyText: "No data",
});
const root = ref<HTMLElement>();
</script>
<template>
	<span v-if="value === null || value === undefined" class="json-content-empty">{{ emptyText }}</span>
	<div
		v-else
		class="json-content"
		:class="{ 'json-content--framed': framed }"
		:style="{ maxHeight: typeof maxHeight === 'number' ? maxHeight + 'px' : maxHeight }"
	>
		<div ref="root" role="tree" aria-label="JSON view" class="json-content__tree">
			<JsonTreeNode :value="value" :depth="0" :last="true" :root-element="root" :initial-expanded="expanded" />
		</div>
	</div>
</template>
