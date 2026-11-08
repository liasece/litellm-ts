<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
defineProps<{ items: readonly { label: string; href: string }[] }>();
const open = ref(false),
	root = ref<HTMLElement>();
function outside(event: MouseEvent) {
	if (event.target instanceof Node && !root.value?.contains(event.target)) open.value = false;
}
watch(open, (value) => {
	if (value) document.addEventListener("mousedown", outside);
	else document.removeEventListener("mousedown", outside);
});
onBeforeUnmount(() => document.removeEventListener("mousedown", outside));
</script>
<template>
	<div ref="root" class="docs-menu" @keydown.esc="open = false">
		<button type="button" :aria-expanded="open" aria-haspopup="true" @click="open = !open">
			<span><slot>Docs</slot></span
			><UiLucideIcon name="ChevronDown" :size="12" :style="open ? { transform: 'rotate(180deg)' } : undefined" aria-hidden="true" />
		</button>
		<div v-if="open" class="docs-menu-popup">
			<a v-for="(item, index) in items" :key="index" :href="item.href" target="_blank" rel="noopener noreferrer" @click="open = false"
				><span>{{ item.label }}</span
				><UiLucideIcon name="ExternalLink" :size="14" aria-hidden="true"
			/></a>
		</div>
	</div>
</template>
<style>
.docs-menu {
	position: relative;
	display: inline-block;
}
.docs-menu > button {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	font-size: 12px;
	line-height: 16px;
	color: #6b7280;
	padding: 4px 8px;
	border: 0;
	border-radius: 4px;
	background: transparent;
	cursor: pointer;
}
.docs-menu > button:hover {
	color: #374151;
}
.docs-menu > button:focus-visible {
	outline: 2px solid #3b82f6;
	outline-offset: 1px;
}
.docs-menu-popup {
	position: absolute;
	right: 0;
	z-index: 50;
	width: 224px;
	padding: 4px 0;
	margin-top: 4px;
	border: 1px solid #e5e7eb;
	border-radius: 8px;
	background: white;
	box-shadow:
		0 10px 15px -3px #0000001a,
		0 4px 6px -4px #0000001a;
}
.docs-menu-popup a {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 8px 16px;
	color: #374151;
	font-size: 14px;
	line-height: 20px;
	text-decoration: none;
}
.docs-menu-popup a:hover {
	background: #f9fafb;
}
.docs-menu-popup svg {
	flex-shrink: 0;
	margin-left: 8px;
	color: #9ca3af;
}
</style>
