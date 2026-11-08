<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { searchToolsApi } from "../api/SearchToolsApi";
import { cleanSearchError } from "../logic/SearchToolLogic";
import type { SearchConnectionResult } from "../support/SearchToolModels";
const props = defineProps<{ params: Record<string, unknown> }>();
const emit = defineEmits<{ complete: []; success: [] }>();
const loading = ref(true),
	result = ref<SearchConnectionResult | null>(null),
	details = ref(false),
	controller = new AbortController();
onMounted(async () => {
	try {
		result.value = await searchToolsApi.test(props.params, controller.signal);
		if (result.value.status === "success") emit("success");
	} catch (error) {
		if (!controller.signal.aborted)
			result.value = {
				status: "error",
				message: error instanceof Error ? error.message : "Unknown error occurred",
				error_type: "NetworkError",
			};
	} finally {
		loading.value = false;
		emit("complete");
	}
});
onBeforeUnmount(() => controller.abort());
</script>
<template>
	<div class="tools-connection-result">
		<div v-if="loading" class="tools-connection-loading">
			<span class="tools-connection-spinner" /><span>Testing connection to {{ params.search_provider || "search provider" }}...</span>
		</div>
		<template v-else-if="result"
			><div v-if="result.status === 'success'" class="tools-connection-success">
				<UiIcon name="CheckCircleFilled" :size="24" />
				<div>
					<strong>Connection to {{ params.search_provider }} successful!</strong>
					<p v-if="result.test_query">
						Test query: <code>{{ result.test_query }}</code>
					</p>
					<p v-if="result.results_count !== undefined">Results retrieved: {{ result.results_count }}</p>
				</div>
			</div>
			<div v-else>
				<h3><UiIcon name="WarningOutlined" :size="24" />Connection to {{ params.search_provider || "search provider" }} failed</h3>
				<div class="tools-connection-error">
					<strong>Error:</strong>
					<p>{{ cleanSearchError(result.message) }}</p>
					<small v-if="result.error_type"
						>Error type: <code>{{ result.error_type }}</code></small
					><UiButton v-if="result.message" variant="link" @click="details = !details">{{
						details ? "Hide Details" : "Show Details"
					}}</UiButton>
				</div>
				<div v-if="details" class="tools-connection-full">
					<strong>Full Error Details</strong>
					<pre>{{ result.message }}</pre>
				</div>
				<aside>
					<strong>Troubleshooting tips:</strong>
					<ul>
						<li>Verify your API key is correct and active</li>
						<li>Check if the search provider service is operational</li>
						<li>Ensure you have sufficient credits/quota with the provider</li>
						<li>Review the provider's documentation for any additional requirements</li>
					</ul>
				</aside>
			</div>
			<footer>
				<a href="https://docs.litellm.ai/docs/search" target="_blank" rel="noopener noreferrer"
					><UiIcon name="InfoCircleOutlined" />View Search Documentation</a
				>
			</footer></template
		>
	</div>
</template>
