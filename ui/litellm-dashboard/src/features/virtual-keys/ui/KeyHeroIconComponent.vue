<script setup lang="ts">
import { computed, h, type VNode } from "vue";
import definitions from "../support/KeyHeroIconDefinitions.json";
interface SvgNode {
	tag: string;
	attrs: Record<string, string | undefined>;
	children: SvgNode[];
}
const props = defineProps<{ name: string }>();
const icons: Record<string, SvgNode> = definitions;
const definition = computed(() => icons[props.name]);
function node(value: SvgNode): VNode {
	return h(value.tag, value.attrs, value.children.map(node));
}
const Content = () => definition.value?.children.map(node);
</script>
<template>
	<svg v-bind="definition?.attrs" class="vk-hero-icon" aria-hidden="true" focusable="false"><Content /></svg>
</template>
<style>
.vk-hero-icon {
	display: inline-block;
	width: 1em;
	height: 1em;
	flex: none;
	vertical-align: -0.125em;
}
</style>
