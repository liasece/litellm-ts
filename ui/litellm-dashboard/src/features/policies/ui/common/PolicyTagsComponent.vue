<script setup lang="ts">
import UiTag from "../../../platform/ui/UiTag.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
withDefaults(defineProps<{ values: readonly string[]; color?: string; limit?: number }>(), { color: undefined, limit: Infinity });
</script>
<template>
	<div v-if="values.length" class="policy-tags">
		<UiTag v-for="(value, index) in values.slice(0, limit)" :key="index" :color="color">{{ value }}</UiTag
		><UiTooltip v-if="values.length > limit" :title="values.slice(limit).join(', ')"
			><UiTag>+{{ values.length - limit }}</UiTag></UiTooltip
		>
	</div>
	<span v-else class="policy-muted">-</span>
</template>
