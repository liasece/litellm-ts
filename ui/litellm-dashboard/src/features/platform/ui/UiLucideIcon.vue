<script setup lang="ts">
import { computed } from "vue";
import icons from "./UiLucideIconDefinitions.json";

interface IconNode {
	tag: string;
	attrs: Record<string, string | number>;
}
const props = withDefaults(defineProps<{ name: string; size?: number | string; strokeWidth?: number | string }>(), {
	size: 24,
	strokeWidth: 2,
});
const definitions = icons as unknown as Record<string, IconNode[]>;
const nodes = computed(() => definitions[props.name] ?? []);
</script>

<template>
	<svg
		xmlns="http://www.w3.org/2000/svg"
		:width="size"
		:height="size"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		:stroke-width="strokeWidth"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
		focusable="false"
		class="ui-lucide-icon"
	>
		<component :is="node.tag" v-for="(node, index) in nodes" :key="index" v-bind="node.attrs" />
	</svg>
</template>

<style>
.ui-lucide-icon {
	display: inline-block;
	vertical-align: middle;
	flex-shrink: 0;
}
</style>
