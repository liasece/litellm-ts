<script setup lang="ts">
/**
 * 紧凑的可排序行：用在不需要卡片厚边框的内联表单里（密钥路由器、团队路由设置）。
 * 与 UiEntryCard 的分工：卡片用于弹窗中的重点配置，行用于表单里顺带排列的候选模型。
 * 二者共用同一套拖拽把手和落点高亮，避免同类“有序配置”在不同页面长得不一样。
 */
import "./SortableStyles.css";
withDefaults(defineProps<{ index?: number }>(), { index: undefined });
</script>

<template>
	<div class="ui-sortable-row">
		<div v-if="$slots.handle" class="ui-sortable-row__handle"><slot name="handle" /></div>
		<span v-if="index !== undefined" class="ui-sortable-row__index" aria-hidden="true">{{ index }}</span>
		<div class="ui-sortable-row__body"><slot /></div>
		<div v-if="$slots.actions" class="ui-sortable-row__actions"><slot name="actions" /></div>
	</div>
</template>

<style scoped>
.ui-sortable-row {
	display: flex;
	align-items: center;
	gap: 10px;
	min-width: 0;
	padding: 8px 10px;
	border: 1px solid var(--ui-tremor-border);
	border-radius: 8px;
	background: var(--ui-surface);
}
.ui-sortable-row:hover {
	border-color: #c7d2fe;
}
.ui-sortable-row__handle {
	display: flex;
	align-items: center;
	flex: none;
	margin-left: -2px;
}
.ui-sortable-row__index {
	display: flex;
	align-items: center;
	justify-content: center;
	flex: none;
	width: 22px;
	height: 22px;
	border-radius: 6px;
	background: #e0e7ff;
	color: #4338ca;
	font: 700 11px/1 var(--ui-font-sans);
}
.ui-sortable-row__body {
	display: flex;
	align-items: center;
	gap: 8px;
	flex: 1 1 auto;
	min-width: 0;
	font: 500 13px/18px var(--ui-font-sans);
}
.ui-sortable-row__actions {
	display: flex;
	align-items: center;
	gap: 4px;
	flex: none;
}
</style>
