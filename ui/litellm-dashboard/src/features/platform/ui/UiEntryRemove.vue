<script setup lang="ts">
/**
 * 条目移除按钮：供「目标 / 回退模型 / 时段」卡片右侧统一使用。
 * 默认灰阶低调显示，悬停才转为危险色，避免每张卡都出现一枚抢眼红图标；
 * 语义是移除这一行配置，不是删除模型本身，所以用 × 而不是垃圾桶。
 */
import UiHeroIcon from "./UiHeroIcon.vue";
withDefaults(defineProps<{ label: string; disabled?: boolean }>(), { disabled: false });
defineEmits<{ click: [MouseEvent] }>();
</script>

<template>
	<button type="button" class="ui-entry-remove" :aria-label="label" :title="label" :disabled="disabled" @click="$emit('click', $event)">
		<UiHeroIcon name="XIcon" :size="16" />
	</button>
</template>

<style scoped>
.ui-entry-remove {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: none;
	width: 24px;
	height: 24px;
	border-radius: 6px;
	color: #9ca3af;
	background: transparent;
	transition:
		color 0.12s ease,
		background-color 0.12s ease;
}
.ui-entry-remove:disabled {
	color: #d1d5db;
	cursor: not-allowed;
}
.ui-entry-remove:hover:not(:disabled) {
	color: var(--ui-danger);
	background: #fef2f2;
}
</style>
