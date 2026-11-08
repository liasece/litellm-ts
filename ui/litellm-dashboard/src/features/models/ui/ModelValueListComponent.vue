<script setup lang="ts">
defineProps<{ value: unknown; emptyLabel: string; color: string }>();
</script>
<template>
	<span v-if="!Array.isArray(value)">{{ value ? String(value) : "Not Set" }}</span>
	<span v-else-if="!value.length">{{ emptyLabel }}</span>
	<div v-else class="model-value-list">
		<span
			v-for="(item, index) in value"
			:key="String(item) + '-' + index"
			class="model-value-pill"
			:class="'model-value-pill--' + color"
			>{{ String(item) }}</span
		>
	</div>
</template>
