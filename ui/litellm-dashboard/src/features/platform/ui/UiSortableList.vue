<script lang="ts">
/** 每个列表实例一个稳定前缀，供键盘移动后按位置重新聚焦把手。 */
let nextGroup = 0;
</script>

<script setup lang="ts" generic="T">
import { nextTick, ref } from "vue";
import { moveListItem } from "../logic/SortableListLogic";
import "./SortableStyles.css";

const props = withDefaults(
	defineProps<{
		items: readonly T[];
		itemKey: (item: T, index: number) => string;
		/** 用于读屏，例如 “target 1 of 3” 或 “executor 2 of 4”。 */
		label: (index: number, total: number) => string;
		disabled?: boolean;
	}>(),
	{ disabled: false },
);
const emit = defineEmits<{ "update:items": [items: T[]] }>();

const group = `sortable-${++nextGroup}`;
const dragging = ref<number | null>(null);
const over = ref<number | null>(null);
const announcement = ref("");

interface ItemBindings {
	"data-sortable-item": string;
	onDragenter: (event: DragEvent) => void;
	onDragover: (event: DragEvent) => void;
	onDrop: (event: DragEvent) => void;
}

interface HandleBindings {
	group: string;
	index: number;
	label: string;
	disabled: boolean;
	onDragstart: (event: DragEvent) => void;
	onDragend: () => void;
	onKeydown: (event: KeyboardEvent) => void;
}

function itemClass(index: number): Record<string, boolean> {
	return {
		"ui-sortable-item": true,
		"ui-sortable-item--dragging": dragging.value === index,
		"ui-sortable-item--over": over.value === index && dragging.value !== null && dragging.value !== index,
	};
}

function itemBindings(index: number): ItemBindings {
	return {
		"data-sortable-item": "",
		onDragenter: (event) => dragover(event, index),
		onDragover: (event) => dragover(event, index),
		onDrop: (event) => drop(event, index),
	};
}

function handleBindings(index: number): HandleBindings {
	return {
		group,
		index,
		label: `Reorder ${props.label(index, props.items.length)}`,
		disabled: props.disabled,
		onDragstart: (event) => start(event, index),
		onDragend: end,
		onKeydown: (event) => keydown(event, index),
	};
}

function start(event: DragEvent, index: number): void {
	if (props.disabled) {
		event.preventDefault();
		return;
	}
	dragging.value = index;
	over.value = index;
	if (!event.dataTransfer) return;
	event.dataTransfer.effectAllowed = "move";
	event.dataTransfer.setData("text/plain", String(index));
	const item = (event.currentTarget as HTMLElement).closest<HTMLElement>(".ui-sortable-item");
	if (item) event.dataTransfer.setDragImage(item, 16, 16);
}

function dragover(event: DragEvent, index: number): void {
	if (props.disabled || dragging.value === null) return;
	event.preventDefault();
	if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
	over.value = index;
}

function drop(event: DragEvent, index: number): void {
	const from = dragging.value;
	if (props.disabled || from === null) return;
	event.preventDefault();
	end();
	void move(from, index);
}

function end(): void {
	dragging.value = null;
	over.value = null;
}

async function move(from: number, to: number): Promise<void> {
	const total = props.items.length;
	if (props.disabled || from < 0 || from >= total || to < 0 || to >= total || from === to) return;
	const next = moveListItem(props.items, from, to);
	emit("update:items", next);
	announcement.value = `Moved ${props.label(from, total)} to position ${to + 1} of ${total}.`;
	await nextTick();
	focusHandle(to);
}

function keydown(event: KeyboardEvent, index: number): void {
	if (props.disabled) return;
	const total = props.items.length;
	const target =
		event.key === "ArrowUp"
			? index - 1
			: event.key === "ArrowDown"
				? index + 1
				: event.key === "Home"
					? 0
					: event.key === "End"
						? total - 1
						: null;
	if (target === null) return;
	event.preventDefault();
	if (target < 0 || target >= total || target === index) {
		announcement.value = `${props.label(index, total)} is already ${index === 0 ? "first" : "last"}.`;
		return;
	}
	void move(index, target);
}

function focusHandle(index: number): void {
	document.querySelector<HTMLElement>(`[data-sortable-group="${group}"][data-sortable-index="${index}"]`)?.focus({ preventScroll: true });
}
</script>

<template>
	<div class="ui-sortable-list">
		<template v-for="(item, index) in items" :key="itemKey(item, index)">
			<slot
				name="item"
				:item="item"
				:index="index"
				:total="items.length"
				:item-props="itemBindings(index)"
				:item-class="itemClass(index)"
				:handle-props="handleBindings(index)"
			/>
		</template>
		<p class="ui-sortable-status" aria-live="polite">{{ announcement }}</p>
	</div>
</template>
