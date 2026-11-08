<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import type { UiTabItem } from "../../platform/ui/UiTypes";
const props = defineProps<{ modelValue: string; items: readonly UiTabItem[] }>();
const emit = defineEmits<{ "update:modelValue": [key: string] }>();
const root = ref<HTMLElement>(),
	overflow = ref(false),
	menuOpen = ref(false),
	leftShade = ref(false),
	rightShade = ref(false),
	hiddenItems = ref<readonly UiTabItem[]>([]),
	moreButton = ref<HTMLButtonElement>();
let observer: ResizeObserver | undefined,
	offset = 0,
	frame = 0;
const slotName = (key: string) => "tab-" + key;
function align(key = props.modelValue) {
	const list = root.value?.querySelector<HTMLElement>(".ui-tabs__list");
	if (!list) return;
	const allTabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
	const total = allTabs.length ? allTabs[allTabs.length - 1].offsetLeft + allTabs[allTabs.length - 1].offsetWidth : 0;
	const rootWidth = root.value?.clientWidth ?? 0;
	overflow.value = total > rootWidth;
	const available = rootWidth - (overflow.value ? 32 : 0),
		selected = allTabs[props.items.findIndex((item) => item.key === key)];
	if (selected) {
		if (selected.offsetLeft < offset) offset = selected.offsetLeft;
		else if (selected.offsetLeft + selected.offsetWidth > offset + available)
			offset = selected.offsetLeft + selected.offsetWidth - available;
	}
	offset = Math.max(0, Math.min(offset, Math.max(0, total - available)));
	list.scrollLeft = offset;
	hiddenItems.value = props.items.filter((item, index) => {
		const tab = allTabs[index];
		return tab && (tab.offsetLeft < offset || tab.offsetLeft + tab.offsetWidth > offset + available);
	});
	leftShade.value = offset > 0;
	rightShade.value = offset < total - available;
}
function select(key: string) {
	emit("update:modelValue", key);
	menuOpen.value = false;
	align(key);
	void nextTick(() => align(key));
}
function focus(event: FocusEvent) {
	const target = event.target;
	if (!(target instanceof HTMLElement) || target.getAttribute("role") !== "tab") return;
	const list = root.value?.querySelector<HTMLElement>(".ui-tabs__list"),
		index = [...(list?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].indexOf(target),
		item = props.items[index];
	if (item) {
		align(item.key);
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => align(item.key));
	}
}
async function menuKey(event: KeyboardEvent) {
	if (event.key === "Escape") {
		event.preventDefault();
		menuOpen.value = false;
		moreButton.value?.focus();
		return;
	}
	if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
	event.preventDefault();
	menuOpen.value = true;
	await nextTick();
	const items = [...(root.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
	if (!items.length) return;
	const index = items.indexOf(document.activeElement as HTMLButtonElement);
	const next =
		event.key === "Home"
			? 0
			: event.key === "End"
				? items.length - 1
				: event.key === "ArrowUp"
					? index <= 0
						? items.length - 1
						: index - 1
					: (index + 1) % items.length;
	items[next]?.focus();
}
function outside(event: PointerEvent) {
	if (event.target instanceof Node && !root.value?.contains(event.target)) menuOpen.value = false;
}
watch([() => props.modelValue, () => props.items], () => void nextTick(() => align()), { deep: true });
onMounted(() => {
	if (root.value && typeof ResizeObserver !== "undefined") {
		observer = new ResizeObserver(() => align());
		observer.observe(root.value);
	}
	document.addEventListener("pointerdown", outside);
	void nextTick(() => align());
});
onBeforeUnmount(() => {
	observer?.disconnect();
	cancelAnimationFrame(frame);
	document.removeEventListener("pointerdown", outside);
});
</script>
<template>
	<div
		ref="root"
		class="cp-tabs-container"
		:class="{ 'cp-tabs-container--overflow': overflow, 'cp-tabs-container--left': leftShade, 'cp-tabs-container--right': rightShade }"
		@focusin="focus"
	>
		<UiTabs :model-value="modelValue" :items="items" class="cp-tabs" @update:model-value="select"
			><template v-for="item in items" #[slotName(item.key)] :key="item.key"
				><span class="cp-tab-label">{{ item.label }}</span></template
			></UiTabs
		>
		<div v-if="overflow" class="cp-tabs-operations">
			<button
				ref="moreButton"
				type="button"
				aria-label="More tabs"
				aria-haspopup="menu"
				:aria-expanded="menuOpen"
				@click="menuOpen = !menuOpen"
				@keydown="menuKey"
			>
				<UiIcon name="EllipsisOutlined" />
			</button>
			<div v-if="menuOpen" role="menu" class="cp-tabs-menu" @keydown="menuKey">
				<button
					v-for="item in hiddenItems"
					:key="item.key"
					type="button"
					role="menuitem"
					:disabled="item.disabled"
					@click="select(item.key)"
				>
					{{ item.label }}
				</button>
			</div>
		</div>
	</div>
</template>
<style>
.cp-tabs-container {
	display: flex;
	position: relative;
	min-width: 0;
}
.cp-tabs-container > .cp-tabs {
	margin-bottom: 0;
	flex: 1;
	min-width: 0;
}
.cp-tabs-container .ui-tabs__list {
	overflow: hidden;
	scroll-behavior: auto;
}
.cp-tabs-operations {
	width: 32px;
	flex: none;
	border-bottom: 1px solid var(--ui-border-subtle);
	margin-bottom: 16px;
	display: flex;
	align-items: center;
	justify-content: center;
}
.cp-tabs-operations > button {
	border: 0;
	background: none;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 46px;
	cursor: pointer;
	padding: 0;
}
.cp-tabs-container--left::before,
.cp-tabs-container--right::after {
	content: "";
	position: absolute;
	z-index: 1;
	pointer-events: none;
	top: 0;
	height: 46px;
	width: 30px;
}
.cp-tabs-container--left::before {
	left: 0;
	box-shadow: inset 10px 0 8px -8px rgb(0 0 0 / 8%);
}
.cp-tabs-container--right::after {
	right: 32px;
	box-shadow: inset -10px 0 8px -8px rgb(0 0 0 / 8%);
}
.cp-tabs-menu {
	position: absolute;
	right: 0;
	top: 44px;
	z-index: 50;
	background: white;
	min-width: 160px;
	border-radius: 8px;
	padding: 4px;
	box-shadow:
		0 6px 16px 0 rgb(0 0 0 / 8%),
		0 3px 6px -4px rgb(0 0 0 / 12%),
		0 9px 28px 8px rgb(0 0 0 / 5%);
}
.cp-tabs-menu > button {
	display: block;
	width: 100%;
	text-align: left;
	padding: 5px 12px;
	border: 0;
	border-radius: 4px;
	background: none;
	font-size: 14px;
	line-height: 22px;
	cursor: pointer;
}
.cp-tabs-menu > button:hover {
	background: rgb(0 0 0 / 4%);
}
.cp-tabs-menu > button:disabled {
	color: rgb(0 0 0 / 25%);
	cursor: not-allowed;
}
</style>
