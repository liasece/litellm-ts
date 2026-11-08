<script setup lang="ts">
import UiCard from "../../platform/ui/UiCard.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { getApiBaseUrl } from "../../platform/support/ApiEnvironmentSupport";
defineProps<{ path: string; target: string; includeSubpath: boolean }>();
const root = getApiBaseUrl().replace(/\/+$/, "");
</script>
<template>
	<UiCard v-if="path && target" :padding="20" class="model-pass-preview"
		><h3>Route Preview</h3>
		<p>How your requests will be routed</p>
		<div class="model-pass-preview-section">
			<strong>Basic routing:</strong>
			<div class="model-pass-route">
				<div>
					<p>Your endpoint</p>
					<code>{{ root + path }}</code>
				</div>
				<UiIcon name="RightOutlined" :size="18" />
				<div>
					<p>Forwards to</p>
					<code>{{ target }}</code>
				</div>
			</div>
		</div>
		<div v-if="includeSubpath" class="model-pass-preview-section">
			<strong>With subpaths:</strong>
			<div class="model-pass-route">
				<div>
					<p>Your endpoint + subpath</p>
					<code>{{ root + path }}<span>/v1/text-to-image/base/model</span></code>
				</div>
				<UiIcon name="RightOutlined" :size="18" />
				<div>
					<p>Forwards to</p>
					<code>{{ target }}<span>/v1/text-to-image/base/model</span></code>
				</div>
			</div>
			<p class="model-pass-preview-note">Any path after {{ path }} will be appended to the target URL</p>
		</div>
		<div v-else class="model-pass-preview-help">
			<UiIcon name="InfoCircleOutlined" /><span
				><strong>Not seeing the routing you wanted?</strong> Try enabling - Include Subpaths - above - this allows subroutes like
				<code>/api/v1/models</code> to be forwarded automatically.</span
			>
		</div></UiCard
	>
</template>
