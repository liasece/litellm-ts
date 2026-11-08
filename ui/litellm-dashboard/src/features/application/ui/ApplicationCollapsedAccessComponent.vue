<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from "vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { nextUiIdentity } from "../../platform/ui/UiIdentity";
import { dashboardHref } from "../logic/NavigationLogic";
import { useBrowserPreferences } from "../stores/BrowserPreferencesStore";
import type { NavigationItem } from "../support/NavigationModels";
defineProps<{ items: readonly NavigationItem[]; uiBase: string; selectedPage: string }>();
const emit = defineEmits<{ navigate: [event: MouseEvent, page: string] }>();
const { preferences } = useBrowserPreferences();
const anchor = ref<HTMLButtonElement>(),
	popup = ref<HTMLElement>(),
	open = ref(false),
	position = ref({ left: "0px", top: "0px" });
const identity = nextUiIdentity("application-access");
let timer: ReturnType<typeof setTimeout> | undefined;
function positionPopup() {
	const a = anchor.value?.getBoundingClientRect(),
		p = popup.value?.getBoundingClientRect();
	if (a)
		position.value = {
			left: a.right + window.scrollX + "px",
			top: window.scrollY + Math.max(4, Math.min(a.top, window.innerHeight - (p?.height ?? 0) - 4)) + "px",
		};
}
async function show() {
	clearTimeout(timer);
	open.value = true;
	await nextTick();
	positionPopup();
	document.addEventListener("pointerdown", outside);
	window.addEventListener("resize", positionPopup);
	window.addEventListener("scroll", positionPopup, true);
}
function hide() {
	clearTimeout(timer);
	open.value = false;
	document.removeEventListener("pointerdown", outside);
	window.removeEventListener("resize", positionPopup);
	window.removeEventListener("scroll", positionPopup, true);
}
function hold() {
	clearTimeout(timer);
}
function enter() {
	clearTimeout(timer);
	timer = setTimeout(() => void show(), 100);
}
function leave() {
	clearTimeout(timer);
	timer = setTimeout(hide, 100);
}
function outside(event: PointerEvent) {
	if (event.target instanceof Node && !anchor.value?.contains(event.target) && !popup.value?.contains(event.target)) hide();
}
async function keyboard(event: KeyboardEvent) {
	if (event.key === "Escape") {
		hide();
		anchor.value?.focus();
		return;
	}
	if (!["ArrowRight", "ArrowDown", "ArrowUp"].includes(event.key)) return;
	event.preventDefault();
	if (!open.value) {
		await show();
		popup.value?.querySelector<HTMLAnchorElement>("a")?.focus();
		return;
	}
	const links = [...(popup.value?.querySelectorAll<HTMLAnchorElement>("a") ?? [])],
		index = links.indexOf(document.activeElement as HTMLAnchorElement),
		direction = event.key === "ArrowUp" ? -1 : 1;
	links[(index + direction + links.length) % links.length]?.focus();
}
function navigate(event: MouseEvent, page: string) {
	emit("navigate", event, page);
	hide();
}
onBeforeUnmount(hide);
</script>
<template>
	<button
		ref="anchor"
		type="button"
		class="application-collapsed-access-anchor"
		aria-label="ACCESS CONTROL"
		aria-haspopup="menu"
		:aria-expanded="open"
		:aria-controls="open ? identity : undefined"
		@mouseenter="enter"
		@mouseleave="leave"
		@focus="enter"
		@click="show"
		@keydown="keyboard"
	></button>
	<Teleport to="body"
		><div
			v-if="open"
			:id="identity"
			ref="popup"
			class="application-collapsed-access-popup"
			:style="position"
			@mouseenter="hold"
			@mouseleave="leave"
			@keydown="keyboard"
		>
			<div class="application-collapsed-access-menu" role="menu" aria-label="ACCESS CONTROL">
				<a
					v-for="item in items"
					:key="item.page"
					:href="dashboardHref(item.page, uiBase)"
					role="menuitem"
					:aria-current="selectedPage === item.page ? 'page' : undefined"
					:class="{ 'application-navigation-item--selected': selectedPage === item.page }"
					@click="navigate($event, item.page)"
					><UiIcon :name="item.icon" :size="15" /><span>{{ item.label }}</span
					><span v-if="item.badge && !preferences.disableShowNewBadge" class="application-new-badge">{{ item.badge }}</span></a
				>
			</div>
		</div></Teleport
	>
</template>
<style>
.application-collapsed-access-anchor {
	display: block;
	width: calc(100% - 8px);
	height: 30px;
	margin: 4px;
	border: 0;
	border-radius: 6px;
	background: transparent;
	cursor: pointer;
}
.application-collapsed-access-anchor:hover,
.application-collapsed-access-anchor[aria-expanded="true"] {
	background: rgba(0, 0, 0, 0.06);
}
.application-collapsed-access-popup {
	position: absolute;
	z-index: 1050;
	padding-left: 8px;
	min-width: 168px;
	color: rgba(0, 0, 0, 0.88);
	font: 13px/30px var(--ui-font-antd);
}
.application-collapsed-access-menu {
	min-width: 160px;
	padding: 4px 0;
	border-radius: 8px;
	background: #fff;
	box-shadow:
		0 6px 16px 0 #00000014,
		0 3px 6px -4px #0000001f,
		0 9px 28px 8px #0000000d;
}
.application-collapsed-access-menu > a {
	display: flex;
	align-items: center;
	gap: 11px;
	height: 30px;
	margin: 0 4px 4px;
	padding: 0 8px;
	border-radius: 4px;
	color: inherit;
	text-decoration: none;
	white-space: nowrap;
}
.application-collapsed-access-menu > a > .ui-icon {
	position: relative;
	top: -1.625px;
}
.application-collapsed-access-menu > a:last-child {
	margin-bottom: 0;
}
.application-collapsed-access-menu > a:hover {
	background: rgba(0, 0, 0, 0.04);
}
</style>
