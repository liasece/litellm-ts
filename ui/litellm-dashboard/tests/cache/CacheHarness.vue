<script setup lang="ts">
import CacheDashboard from "../../src/features/cache/ui/CacheDashboardComponent.vue";
</script>
<template>
	<main class="application-main cache-fixture"><CacheDashboard /></main>
</template>
<style>
.cache-fixture {
	width: calc(100vw - 220px);
	margin-left: 220px;
}
@media (max-width: 767px) {
	.cache-fixture {
		width: 100vw;
		margin-left: 0;
	}
}
</style>
