<script setup lang="ts">
defineProps<{ open: boolean }>();
</script>
<template>
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		fill="currentColor"
		aria-hidden="true"
		:style="open ? undefined : { transform: 'rotate(180deg)' }"
	>
		<path d="M11.9999 10.8284L7.0502 15.7782L5.63599 14.364L11.9999 8L18.3639 14.364L16.9497 15.7782L11.9999 10.8284Z" />
	</svg>
</template>
