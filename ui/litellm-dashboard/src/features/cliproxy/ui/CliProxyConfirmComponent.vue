<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
const props = defineProps<{ title: string; description: string; disabled?: boolean }>();
const emit = defineEmits<{ confirm: [] }>();
const open = ref(false);
const anchor = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const position = ref({ top: 0, left: 0 });
const panelStyle = computed(() => ({ top: position.value.top + "px", left: position.value.left + "px" }));
function close() {
	open.value = false;
	document.removeEventListener("pointerdown", outside);
	document.removeEventListener("keydown", keyboard);
	window.removeEventListener("resize", place);
	window.removeEventListener("scroll", place, true);
}
function place() {
	const rect = anchor.value?.getBoundingClientRect();
	if (!rect) return;
	const width = Math.min(300, window.innerWidth - 24);
	const height = panel.value?.offsetHeight ?? 150;
	position.value = {
		left: Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12),
		top: rect.bottom + height + 12 > window.innerHeight ? Math.max(12, rect.top - height - 12) : rect.bottom + 12,
	};
}
function outside(event: PointerEvent) {
	if (!panel.value?.contains(event.target as Node) && !anchor.value?.contains(event.target as Node)) close();
}
function keyboard(event: KeyboardEvent) {
	if (event.key === "Escape") {
		close();
		anchor.value?.querySelector("button")?.focus();
	}
}
async function toggle() {
	if (props.disabled) return;
	if (open.value) return close();
	open.value = true;
	await nextTick();
	place();
	document.addEventListener("pointerdown", outside);
	document.addEventListener("keydown", keyboard);
	window.addEventListener("resize", place);
	window.addEventListener("scroll", place, true);
}
onBeforeUnmount(close);
</script>
<template>
	<span ref="anchor" class="cp-confirm-anchor" @click="toggle"><slot /></span>
	<Teleport to="body">
		<div v-if="open" ref="panel" role="alertdialog" :aria-label="title" class="cp-confirm-popover" :style="panelStyle">
			<div class="cp-confirm-title">
				<span class="cp-confirm-question" aria-hidden="true">?</span><strong>{{ title }}</strong>
			</div>
			<p>{{ description }}</p>
			<div class="cp-confirm-actions">
				<UiButton size="small" @click="close">Cancel</UiButton
				><UiButton
					size="small"
					variant="primary"
					@click="
						close();
						emit('confirm');
					"
					>OK</UiButton
				>
			</div>
		</div>
	</Teleport>
</template>
