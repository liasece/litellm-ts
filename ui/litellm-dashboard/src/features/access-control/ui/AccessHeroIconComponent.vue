<script setup lang="ts">
import definitions from "../support/AccessHeroIcons.json";
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 16 });
const paths: Record<string, string[]> = definitions;
</script>
<template>
	<svg
		:width="size"
		:height="size"
		:style="{ width: size + 'px', height: size + 'px', flexShrink: 0 }"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		:stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path v-for="(value, index) in paths[name] ?? []" :key="index" :d="value" />
	</svg>
</template>
