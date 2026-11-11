<script setup lang="ts">
import { computed } from "vue";
import { getApiBaseUrl } from "../../platform/api/HttpApiClient";
import { useApplicationStore } from "../stores/ApplicationStore";

const application = useApplicationStore();
const fallback = computed(() => getApiBaseUrl() + "/get_image");
const source = computed(() => application.state.theme.logo_url || fallback.value);

/**
 * Replace a broken custom logo with the logo resolved by the proxy.
 * @param event - Failed image load.
 */
function useFallback(event: Event): void {
	const image = event.target as HTMLImageElement;
	if (image.getAttribute("src") !== fallback.value) image.src = fallback.value;
}
</script>
<template><img :src="source" class="application-brand-logo" alt="LiteLLM" @error="useFallback" /></template>
<style scoped>
.application-brand-logo {
	display: block;
	max-width: 100%;
	object-fit: contain;
}
</style>
