<script setup lang="ts">
withDefaults(defineProps<{ size?: number; label?: string }>(), { size: 20, label: "Loading" });
</script>

<template>
	<span class="ui-spinner" role="status" :aria-label="label" :style="{ width: size + 'px', height: size + 'px' }">
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" opacity=".2" />
			<path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
		</svg>
	</span>
</template>
