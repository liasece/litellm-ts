<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch, type FunctionalComponent } from "vue";
import type { UiAppearance, UiTabItem } from "./UiTypes";

const props = withDefaults(
	defineProps<{ modelValue?: string; items: readonly UiTabItem[]; appearance?: UiAppearance; grouped?: boolean; label?: string }>(),
	{
		modelValue: "",
		appearance: "antd",
		grouped: false,
		label: undefined,
	},
);
const TabGroup: FunctionalComponent<{ grouped: boolean }> = (group, { slots }) =>
	group.grouped ? h("div", { class: "ui-tabs__group" }, slots.default?.()) : slots.default?.();
const emit = defineEmits<{ "update:modelValue": [key: string]; change: [key: string] }>();
const activeKey = computed(() => props.modelValue || props.items.find((item) => !item.disabled)?.key || "");
const list = ref<HTMLElement>();
let resizeObserver: ResizeObserver | undefined;
function revealActiveTab() {
	if (props.appearance !== "antd") return;
	const navigation = list.value;
	const tab = navigation?.querySelector<HTMLElement>('[aria-selected="true"]');
	if (!navigation || !tab) return;
	const left = tab.offsetLeft,
		right = left + tab.offsetWidth;
	if (left < navigation.scrollLeft) navigation.scrollLeft = left;
	else if (right > navigation.scrollLeft + navigation.clientWidth) navigation.scrollLeft = right - navigation.clientWidth;
}
watch([activeKey, () => props.items], () => nextTick(revealActiveTab), { flush: "post" });
onMounted(() => {
	resizeObserver = new ResizeObserver(revealActiveTab);
	if (list.value) resizeObserver.observe(list.value);
	void nextTick(revealActiveTab);
});
onBeforeUnmount(() => resizeObserver?.disconnect());
function activate(item: UiTabItem) {
	if (item.disabled) return;
	emit("update:modelValue", item.key);
	emit("change", item.key);
}
function keydown(event: KeyboardEvent, index: number) {
	const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
	if (!direction) return;
	event.preventDefault();
	for (let offset = 1; offset <= props.items.length; offset++) {
		const next = (index + direction * offset + props.items.length) % props.items.length;
		const item = props.items[next];
		if (item && !item.disabled) {
			activate(item);
			const parent = (event.currentTarget as HTMLElement).parentElement;
			parent?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
			break;
		}
	}
}
</script>

<template>
	<div class="ui-tabs" :class="'ui-tabs--' + appearance">
		<div ref="list" class="ui-tabs__list" role="tablist" :aria-label="label">
			<TabGroup :grouped="grouped">
				<button
					v-for="(item, index) in items"
					:key="item.key"
					type="button"
					role="tab"
					class="ui-tabs__tab"
					:class="{ 'ui-tabs__tab--active': item.key === activeKey }"
					:disabled="item.disabled"
					:aria-selected="item.key === activeKey"
					:tabindex="item.key === activeKey ? 0 : -1"
					@click="activate(item)"
					@keydown="keydown($event, index)"
				>
					<slot :name="'tab-' + item.key" :item="item"
						>{{ item.label }}<span v-if="item.count != null" class="ui-tabs__count">{{ item.count }}</span></slot
					>
				</button>
			</TabGroup>
			<div v-if="$slots.extra" class="ui-tabs__extra"><slot name="extra" /></div>
		</div>
		<div v-if="$slots.default" class="ui-tabs__panel" role="tabpanel"><slot :active-key="activeKey" /></div>
	</div>
</template>
