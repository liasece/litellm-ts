<script setup lang="ts">
withDefaults(defineProps<{ color?: string; small?: boolean }>(), { color: "blue" });
</script>
<template>
	<span class="vk-badge" :class="['vk-badge--' + color, { 'vk-badge--small': small }]"><slot /></span>
</template>
