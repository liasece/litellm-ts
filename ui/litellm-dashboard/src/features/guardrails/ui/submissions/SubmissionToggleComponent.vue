<script setup lang="ts">
defineProps<{ enabled: boolean }>();
const emit = defineEmits<{ toggle: [] }>();
</script>
<template>
	<button
		type="button"
		role="switch"
		:aria-checked="enabled"
		:class="['guardrail-submission-toggle', { enabled }]"
		@click="emit('toggle')"
	>
		<span />
	</button>
</template>
