<script setup lang="ts">
withDefaults(defineProps<{ label: string; value: string | number; color?: string; subtitle?: string }>(), {
	color: "default",
	subtitle: undefined,
});
</script>
<template>
	<div class="monitor-metric-card">
		<header>
			<span>{{ label }}</span
			><span v-if="$slots.icon" class="monitor-metric-icon"><slot name="icon" /></span>
		</header>
		<strong :class="'monitor-color-' + color">{{ value }}</strong>
		<p v-if="subtitle">{{ subtitle }}</p>
	</div>
</template>
