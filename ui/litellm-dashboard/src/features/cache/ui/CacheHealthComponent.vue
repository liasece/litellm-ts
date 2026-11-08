<script setup lang="ts">
import { ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import CacheHealthPanel from "./CacheHealthPanelComponent.vue";
import { cacheApi } from "../api/CacheApi";
import { failedCacheHealth } from "../logic/CacheHealthLogic";
import notification from "../../notifications/logic/NotificationManager";
const response = ref<Record<string, unknown> | null>(null),
	pending = ref(false),
	time = ref<number | null>(null);
async function run() {
	pending.value = true;
	const start = performance.now();
	notification.info("Running cache health check...");
	response.value = null;
	try {
		response.value = await cacheApi.ping();
	} catch (error) {
		response.value = failedCacheHealth(error);
	} finally {
		time.value = performance.now() - start;
		pending.value = false;
	}
}
</script>
<template>
	<div class="cache-health">
		<header>
			<UiButton appearance="tremor" variant="primary" :disabled="pending" class="cache-health-run" @click="run">{{
				pending ? "Running Health Check..." : "Run Health Check"
			}}</UiButton
			><span v-if="time !== null" class="cache-response-time"
				><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<path
						d="M12 6V12L16 14M12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2Z"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
				>{{ time.toFixed(0) }}ms</span
			>
		</header>
		<CacheHealthPanel v-if="response" :response="response" />
	</div>
</template>
