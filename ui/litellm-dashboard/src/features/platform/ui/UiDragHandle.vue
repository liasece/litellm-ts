<script setup lang="ts">
import UiLucideIcon from "./UiLucideIcon.vue";
import "./SortableStyles.css";

withDefaults(
	defineProps<{
		label: string;
		disabled?: boolean;
		group?: string;
		index?: number;
	}>(),
	{ disabled: false, group: undefined, index: undefined },
);
</script>

<template>
	<button
		type="button"
		class="ui-drag-handle"
		:aria-label="label"
		:title="disabled ? 'Reordering is unavailable while saving' : 'Drag to reorder, or press ↑/↓'"
		:disabled="disabled"
		:draggable="!disabled"
		:data-sortable-group="group"
		:data-sortable-index="index"
	>
		<UiLucideIcon name="GripVertical" :size="16" />
	</button>
</template>

<style scoped>
.ui-drag-handle {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: none;
	width: 22px;
	height: 24px;
	padding: 0;
	border: 0;
	border-radius: 5px;
	background: transparent;
	color: #9ca3af;
	cursor: grab;
	touch-action: none;
	transition:
		color 0.12s ease,
		background-color 0.12s ease;
}
.ui-drag-handle:hover:not(:disabled) {
	color: #4b5563;
	background: #eef2ff;
}
.ui-drag-handle:active:not(:disabled) {
	cursor: grabbing;
}
.ui-drag-handle:focus-visible {
	outline: 2px solid var(--ui-brand, #6366f1);
	outline-offset: 1px;
}
.ui-drag-handle:disabled {
	color: #d1d5db;
	cursor: not-allowed;
}
</style>
