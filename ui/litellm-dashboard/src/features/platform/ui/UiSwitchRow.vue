<script setup lang="ts">
import UiSwitch from "./UiSwitch.vue";
/**
 * 开关行：左侧标题与说明，右侧开关。用于 fallback 递归这类"整组生效"的选项，
 * 让它在分区底部与条目列表分开，避免混进候选目标里被当成又一条目标。
 */
withDefaults(defineProps<{ modelValue?: boolean; label: string; description?: string; disabled?: boolean }>(), {
	modelValue: false,
	description: undefined,
	disabled: false,
});
defineEmits<{ "update:modelValue": [value: boolean] }>();
</script>

<template>
	<div class="ui-switch-row" :class="{ 'ui-switch-row--disabled': disabled }">
		<div class="ui-switch-row__text">
			<span class="ui-switch-row__label">{{ label }}</span>
			<span v-if="description" class="ui-switch-row__description">{{ description }}</span>
		</div>
		<UiSwitch
			:model-value="modelValue"
			:disabled="disabled"
			:aria-label="label"
			@update:model-value="$emit('update:modelValue', $event)"
		/>
	</div>
</template>

<style scoped>
.ui-switch-row {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 16px;
}
.ui-switch-row--disabled {
	opacity: 0.6;
}
.ui-switch-row__text {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}
.ui-switch-row__label {
	font: 500 13px/18px var(--ui-font-sans);
	color: #374151;
}
.ui-switch-row__description {
	font: 400 12px/17px var(--ui-font-sans);
	color: var(--ui-text-muted);
}
.ui-switch-row > :not(.ui-switch-row__text) {
	flex: none;
	margin-top: 1px;
}
</style>
