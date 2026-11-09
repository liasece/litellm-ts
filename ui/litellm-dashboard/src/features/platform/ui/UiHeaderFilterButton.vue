<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import UiTableFilterPanel from "./UiTableFilterPanel.vue";
import type { UiTableActiveFilter, UiTableFilterField } from "./UiTableFilterModels";

const props = withDefaults(
	defineProps<{ label: string; fields: readonly UiTableFilterField[]; active?: readonly UiTableActiveFilter[] }>(),
	{ active: () => [] },
);
const emit = defineEmits<{ change: [entries: UiTableActiveFilter[]] }>();

const button = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const open = ref(false);
const session = ref(0);
const target = ref<HTMLElement | string>("body");
const position = ref({ top: 0, left: 0 });
const activeCount = computed(() => props.active.filter((filter) => filter.value).length);

function measure(): void {
	const trigger = button.value;
	if (!trigger) return;
	const rect = trigger.getBoundingClientRect();
	const width = panel.value?.offsetWidth ?? 288;
	const height = panel.value?.offsetHeight ?? 280;
	const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
	let top = rect.bottom + 6;
	if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
	position.value = { top, left };
}

async function show(): Promise<void> {
	target.value = button.value?.closest("dialog") ?? document.body;
	open.value = true;
	session.value += 1;
	await nextTick();
	measure();
	window.requestAnimationFrame(measure);
	document.addEventListener("pointerdown", outside, true);
	document.addEventListener("keydown", escape, true);
	window.addEventListener("resize", measure);
	document.addEventListener("scroll", scrolled, true);
}

function hide(refocus = false): void {
	if (!open.value) return;
	open.value = false;
	document.removeEventListener("pointerdown", outside, true);
	document.removeEventListener("keydown", escape, true);
	window.removeEventListener("resize", measure);
	document.removeEventListener("scroll", scrolled, true);
	if (refocus) button.value?.focus();
}

function toggle(): void {
	if (open.value) hide();
	else void show();
}

function outside(event: Event): void {
	const node = event.target;
	if (!(node instanceof Node)) return;
	if (panel.value?.contains(node) || button.value?.contains(node)) return;
	hide();
}

function escape(event: KeyboardEvent): void {
	if (event.key !== "Escape" || !open.value) return;
	event.stopPropagation();
	hide(true);
}

/** 面板使用视口坐标；表格滚动后锚点不可靠，直接收起。 */
function scrolled(event: Event): void {
	const node = event.target;
	if (node instanceof Node && panel.value?.contains(node)) return;
	hide();
}

function change(entries: UiTableActiveFilter[]): void {
	emit("change", entries);
	hide(true);
}

onBeforeUnmount(() => hide());
</script>

<template>
	<button
		ref="button"
		type="button"
		class="ui-header-filter"
		:class="{ 'ui-header-filter--active': activeCount > 0 }"
		:aria-label="label + ' filters'"
		:aria-expanded="open"
		aria-haspopup="dialog"
		@click.stop="toggle"
	>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
			<path stroke-linecap="round" stroke-linejoin="round" d="M4 5h16l-6.5 7.5V19l-3 1.5v-8L4 5z" />
		</svg>
		<span v-if="activeCount > 1" class="ui-header-filter__count" aria-hidden="true">{{ activeCount }}</span>
	</button>
	<Teleport :to="target">
		<div
			v-if="open"
			ref="panel"
			class="ui-filter-popover"
			role="dialog"
			:aria-label="label + ' filters'"
			:style="{ top: position.top + 'px', left: position.left + 'px' }"
		>
			<UiTableFilterPanel :key="session" :label="label" :fields="fields" :active="active" @commit="change" @cancel="hide(true)" />
		</div>
	</Teleport>
</template>
