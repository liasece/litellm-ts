<script setup lang="ts">
withDefaults(defineProps<{ message?: string }>(), { message: "Ask your proxy admin for access to this page" });
</script>

<template>
	<div class="ui-access-denied">
		<h1>Access Denied</h1>
		<p>{{ message }}</p>
	</div>
</template>
