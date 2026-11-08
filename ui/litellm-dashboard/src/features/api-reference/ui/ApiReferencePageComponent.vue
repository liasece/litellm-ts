<script setup lang="ts">
import { computed, ref } from "vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import { useApplicationStore } from "../../application/stores/ApplicationStore";
import examplesData from "../data/ApiReferenceExamples.json";
import { apiReferenceBaseUrl } from "../logic/ApiReferenceLogic";
import type { ApiReferenceExample } from "../support/ApiReferenceModels";
import ApiReferenceCodeComponent from "./ApiReferenceCodeComponent.vue";
const application = useApplicationStore(),
	active = ref("0");
const examples: readonly ApiReferenceExample[] = examplesData;
const baseUrl = computed(() => apiReferenceBaseUrl(application.state.proxySettings));
</script>
<template>
	<div class="api-reference-grid">
		<div class="api-reference-block">
			<div class="api-reference-heading">
				<p>OpenAI Compatible Proxy: API Reference</p>
				<a
					href="https://docs.litellm.ai/docs/proxy/user_keys"
					target="_blank"
					rel="noopener noreferrer"
					title="Open documentation in a new tab"
					class="api-reference-doc-link"
					><span>API Reference Docs</span
					><UiLucideIcon name="ExternalLink" :size="24" aria-hidden="true" style="width: 16px; height: 16px; opacity: 0.8" /><span
						class="api-reference-sr-only"
						>(opens in a new tab)</span
					></a
				>
			</div>
			<p class="api-reference-description">
				LiteLLM is OpenAI Compatible. This means your API Key works with the OpenAI SDK. Just replace the base_url to point to your
				litellm proxy. Example Below
			</p>
			<UiTabs v-model="active" appearance="tremor" :items="examples.map((example) => ({ key: example.key, label: example.label }))"
				><div v-for="example in examples" :key="example.key" :hidden="active !== example.key">
					<ApiReferenceCodeComponent :example="example" :base-url="baseUrl" /></div
			></UiTabs>
		</div>
	</div>
</template>
<style>
.api-reference-grid {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	margin-top: 8px;
	width: 100%;
	gap: 8px;
	padding: 16px;
}
.api-reference-block {
	margin-bottom: 20px;
	min-width: 0;
}
.api-reference-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
}
.api-reference-heading > p {
	margin: 0;
	font-size: 24px;
	line-height: 32px;
	font-weight: 600;
	color: #111827;
}
.api-reference-doc-link {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	gap: 8px;
	margin-left: 12px;
	padding: 8px 14px;
	border: 1px solid #e4e4e7;
	border-radius: 12px;
	background: #ffffffcc;
	box-shadow: 0 1px 2px #0000000d;
	color: #3f3f46;
	font-size: 14px;
	line-height: 20px;
	font-weight: 500;
	text-decoration: none;
}
.api-reference-doc-link:hover {
	background: #fff;
}
.api-reference-doc-link:focus-visible {
	outline: 2px solid #3b82f6;
	outline-offset: 2px;
}
.api-reference-doc-link:active {
	transform: translateY(0.5px);
}
.api-reference-description {
	margin: 8px 0;
	font-size: 12.4px;
	line-height: 18.4px;
	color: #6b7280;
}
.api-reference-sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border-width: 0;
}
@media (min-width: 640px) {
	.api-reference-grid {
		height: 80vh;
		padding: 32px;
	}
}
</style>
