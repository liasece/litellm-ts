<script setup lang="ts">
import { nextTick, onBeforeUnmount, onUpdated, ref, useSlots, watch } from "vue";
import { nextUiIdentity } from "./UiIdentity";

const props = withDefaults(
	defineProps<{
		content?: string;
		placement?: "top" | "bottom" | "bottomLeft" | "topLeft" | "left" | "right";
		trigger?: "hover" | "click";
		dark?: boolean;
		popupClass?: string;
		popupRole?: "tooltip" | "menu";
	}>(),
	{ content: undefined, placement: "top", trigger: "hover", popupClass: undefined, popupRole: "tooltip" },
);
const slots = useSlots();
function hasContent() {
	return Boolean(slots.content) || (props.content != null && props.content !== "");
}
const anchor = ref<HTMLElement>();
const popup = ref<HTMLElement>();
const target = ref<HTMLElement | string>("body");
const open = ref(false);
const style = ref<Record<string, string>>({});
const identity = nextUiIdentity("ui-popover");
let timer: ReturnType<typeof setTimeout> | undefined;
function cancelTimer() {
	if (timer) clearTimeout(timer);
	timer = undefined;
}
async function show() {
	cancelTimer();
	if (!hasContent()) {
		hide();
		return;
	}
	target.value = anchor.value?.closest("dialog") ?? document.body;
	open.value = true;
	await nextTick();
	if (!open.value || !hasContent()) return;
	reposition();
	document.addEventListener("pointerdown", outside);
	window.addEventListener("resize", reposition);
	window.addEventListener("scroll", reposition, true);
}
function hide() {
	cancelTimer();
	open.value = false;
	document.removeEventListener("pointerdown", outside);
	window.removeEventListener("resize", reposition);
	window.removeEventListener("scroll", reposition, true);
}
function scheduleShow() {
	if (props.trigger === "hover") {
		cancelTimer();
		timer = setTimeout(() => void show(), 100);
	}
}
function scheduleHide() {
	if (props.trigger === "hover") {
		cancelTimer();
		timer = setTimeout(hide, 100);
	}
}
function outside(event: PointerEvent) {
	if (event.target instanceof Node && !anchor.value?.contains(event.target) && !popup.value?.contains(event.target)) hide();
}
function reposition() {
	const a = anchor.value?.getBoundingClientRect();
	const p = popup.value?.getBoundingClientRect();
	if (!a || !p) return;
	let top = props.placement.startsWith("bottom") ? a.bottom + 8 : a.top - p.height - 8;
	let left = props.placement.endsWith("Left") ? a.left : a.left + (a.width - p.width) / 2;
	if (props.placement === "right") {
		top = a.top + (a.height - p.height) / 2;
		left = a.right + 8;
	}
	if (props.placement === "left") {
		top = a.top + (a.height - p.height) / 2;
		left = a.left - p.width - 8;
	}
	if (top < 4) top = a.bottom + 8;
	if (top + p.height > window.innerHeight - 4) top = Math.max(4, a.top - p.height - 8);
	left = Math.max(4, Math.min(left, window.innerWidth - p.width - 4));
	style.value = { top: top + "px", left: left + "px", "--ui-popover-anchor-x": a.left + a.width / 2 - left + "px" };
}
function click() {
	if (props.trigger === "click") {
		if (open.value) hide();
		else void show();
	}
}
function focusIn() {
	if (props.trigger === "hover") void show();
}
function focusOut(event: FocusEvent) {
	if (event.relatedTarget instanceof Node && (popup.value?.contains(event.relatedTarget) || anchor.value?.contains(event.relatedTarget)))
		return;
	hide();
}
watch(
	() => props.content,
	async () => {
		if (!hasContent()) hide();
		else if (open.value) {
			await nextTick();
			if (open.value) reposition();
		}
	},
);
onUpdated(() => {
	if (open.value && !hasContent()) hide();
});
defineExpose({ show, hide });
onBeforeUnmount(hide);
</script>

<template>
	<span
		ref="anchor"
		class="ui-popover-anchor"
		:aria-describedby="open ? identity : undefined"
		@mouseenter="scheduleShow"
		@mouseleave="scheduleHide"
		@focusin="focusIn"
		@focusout="focusOut"
		@click="click"
		@keydown.esc.stop="hide"
		><slot
	/></span>
	<Teleport :to="target"
		><div
			v-if="open"
			:id="identity"
			ref="popup"
			:role="popupRole"
			class="ui-popover"
			:class="[popupClass, { 'ui-popover--dark': dark }]"
			:style="style"
			@mouseenter="cancelTimer"
			@mouseleave="scheduleHide"
			@keydown.esc.stop="hide"
		>
			<slot name="content">{{ content }}</slot>
		</div></Teleport
	>
</template>
