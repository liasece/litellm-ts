<script setup lang="ts">
import { onMounted, onBeforeUnmount } from "vue";
import UiAlert from "../../../platform/ui/UiAlert.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import { applicationHealthReadinessStore as store } from "../stores/HealthReadinessStore";
import "../styles/HealthReadinessStyles.css";
let release: (() => void) | undefined;
onMounted(() => {
	release = store.acquire();
});
onBeforeUnmount(() => release?.());
</script>
<template>
	<UiAlert
		v-if="store.data.value?.is_detailed_debug === true"
		type="warning"
		title="Performance Warning: Detailed Debug Mode Active"
		role="alert"
		class="application-debug-warning-banner"
	>
		<template #icon><UiIcon name="ExclamationCircleOutlined" :size="24" /></template>
		Detailed debug logging (<code>LITELLM_LOG=DEBUG</code>) is currently enabled. This mode logs extensive diagnostic information and
		will significantly degrade performance. It should only be used for troubleshooting and disabled in production environments.
	</UiAlert>
</template>
