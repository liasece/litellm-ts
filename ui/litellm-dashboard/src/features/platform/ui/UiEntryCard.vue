<script setup lang="ts">
/**
 * 条目卡片：给候选目标（模型、别名、时段）一个有边界的盒子，顺序由左侧序号表达。
 * 标题行放序号与名称，操作按钮靠右，正文放该条目的输入控件。
 */
withDefaults(defineProps<{ index?: number; primary?: boolean }>(), { index: undefined, primary: false });
</script>

<template>
	<article class="ui-entry-card" :class="{ 'ui-entry-card--primary': primary }">
		<div class="ui-entry-card__head">
			<span v-if="index !== undefined" class="ui-entry-card__badge" aria-hidden="true">{{ index }}</span>
			<div class="ui-entry-card__title"><slot name="title" /></div>
			<div v-if="$slots.actions" class="ui-entry-card__actions"><slot name="actions" /></div>
		</div>
		<div v-if="$slots.default" class="ui-entry-card__body"><slot /></div>
	</article>
</template>

<style scoped>
.ui-entry-card {
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-width: 0;
	padding: 10px 12px;
	border: 1px solid var(--ui-tremor-border);
	border-radius: 10px;
	background: var(--ui-surface-subtle);
}
.ui-entry-card:hover {
	border-color: #c7d2fe;
}
.ui-entry-card--primary {
	border-color: #c7d2fe;
	background: #fbfbff;
}
.ui-entry-card__head {
	display: flex;
	align-items: center;
	gap: 10px;
	min-width: 0;
}
.ui-entry-card__badge {
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
.ui-entry-card--primary .ui-entry-card__badge {
	background: var(--ui-brand);
	color: white;
}
.ui-entry-card__title {
	display: flex;
	align-items: center;
	gap: 8px;
	flex: 1 1 auto;
	min-width: 0;
	font: 500 13px/18px var(--ui-font-sans);
	color: #374151;
}
.ui-entry-card__actions {
	display: flex;
	align-items: center;
	gap: 4px;
	flex: none;
	margin-left: auto;
}
.ui-entry-card__body {
	min-width: 0;
}
</style>
