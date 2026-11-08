<script setup lang="ts">
import { computed, h, type VNode } from "vue";
import definitionsData from "./UiHeroIconDefinitions.json";
interface IconNode {
	tag: string;
	attributes: Record<string, string | undefined>;
	children: IconNode[];
}
const props = withDefaults(defineProps<{ name: string; size?: number | string }>(), { size: 20 });
const definitions: Record<string, IconNode> = definitionsData;
const definition = computed(() => definitions[props.name] ?? definitions[props.name + "Icon"]);
function node(value: IconNode): VNode {
	return h(value.tag, value.attributes, value.children.map(node));
}
const Content = () => definition.value?.children.map(node) ?? [];
</script>
<template>
	<svg v-bind="definition?.attributes" :width="size" :height="size" class="ui-hero-icon" aria-hidden="true"><Content /></svg>
</template>
<style>
.ui-hero-icon {
	display: inline-block;
	flex-shrink: 0;
	vertical-align: middle;
}
</style>
