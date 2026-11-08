<script setup lang="ts">
import { h, onBeforeUnmount, ref, type VNodeChild } from "vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import { copyText } from "../logic/ClipboardLogic";
import type { SyntaxElement, SyntaxNode } from "../support/SyntaxModels";
const props = defineProps<{ code: string; tree: SyntaxElement; replaceText?: (value: string) => string }>();
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
function syntax(node: SyntaxNode): VNodeChild {
	if (typeof node === "string") return props.replaceText ? props.replaceText(node) : node;
	if (!["pre", "code", "span"].includes(node.tag)) return "";
	return h(node.tag, { class: node.attributes.class, style: node.attributes.style }, node.children.map(syntax));
}
const SyntaxTree = () => syntax(props.tree);
async function copy() {
	try {
		await copyText(props.code);
		copied.value = true;
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(() => {
			copied.value = false;
			timer = null;
		}, 2000);
	} catch {
		/* Code remains selectable. */
	}
}
onBeforeUnmount(() => {
	if (timer !== null) clearTimeout(timer);
});
</script>
<template>
	<div class="content-code-block">
		<button type="button" aria-label="Copy code" @click="copy">
			<UiLucideIcon :name="copied ? 'CheckIcon' : 'ClipboardIcon'" :size="16" /></button
		><SyntaxTree />
	</div>
</template>
<style>
.content-code-block {
	position: relative;
	border: 1px solid #e5e7eb;
	border-radius: 8px;
	overflow: hidden;
}
.content-code-block > button {
	display: flex;
	align-items: center;
	justify-content: center;
	position: absolute;
	top: 12px;
	right: 12px;
	z-index: 10;
	padding: 8px;
	border: 0;
	border-radius: 6px;
	background: #f3f4f6;
	color: #4b5563;
	cursor: pointer;
}
.content-code-block > button:hover {
	background: #e5e7eb;
}
</style>
