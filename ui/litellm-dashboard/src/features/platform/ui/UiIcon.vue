<script setup lang="ts">
import { computed, h, type VNode } from "vue";
import definitions from "./icons/IconDefinitions.json";

interface SvgNode {
	tag: string;
	attrs?: Record<string, string | undefined>;
	children?: SvgNode[];
}
interface IconDefinition {
	icon: SvgNode;
}
const props = defineProps<{ name?: string; size?: number | string; title?: string; spin?: boolean }>();
const iconDefinitions: Record<string, IconDefinition> = definitions;
const normalize = (value: string) =>
	value
		.replace(/(?:Outlined|Filled|TwoTone)$/, "")
		.replace(/[-_\s]/g, "")
		.toLowerCase();
const aliases = new Map(Object.keys(iconDefinitions).map((name) => [normalize(name), name]));
const definition = computed(() => iconDefinitions[props.name ?? ""] ?? iconDefinitions[aliases.get(normalize(props.name ?? "")) ?? ""]);
const fillRule = computed(() => {
	const value = definition.value?.icon.attrs?.["fill-rule"];
	return value === "evenodd" || value === "nonzero" || value === "inherit" ? value : undefined;
});
function renderNode(node: SvgNode): VNode {
	return h(node.tag, node.attrs ?? {}, node.children?.map(renderNode));
}
const IconContent = () => definition.value?.icon.children?.map(renderNode) ?? [];
</script>

<template>
	<svg
		class="ui-icon"
		:class="{ 'ui-icon--spin': spin || normalize(name ?? '') === 'loading' }"
		:viewBox="definition?.icon.attrs?.viewBox || '0 0 1024 1024'"
		:fill-rule="fillRule"
		:style="size != null ? { fontSize: typeof size === 'number' ? size + 'px' : size } : undefined"
		:role="title ? 'img' : undefined"
		:aria-label="title"
		:aria-hidden="title ? undefined : true"
		focusable="false"
		fill="currentColor"
	>
		<slot><IconContent /></slot>
	</svg>
</template>

<style>
.ui-icon--spin {
	animation: ui-icon-spin 1s linear infinite;
}
@keyframes ui-icon-spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
