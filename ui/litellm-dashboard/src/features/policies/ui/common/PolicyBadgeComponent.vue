<script setup lang="ts">
withDefaults(defineProps<{ color?: string; small?: boolean }>(), { color: "blue" });
</script>
<template>
	<span class="policy-badge" :class="['policy-badge--' + color, { 'policy-badge--small': small }]"><slot /></span>
</template>
