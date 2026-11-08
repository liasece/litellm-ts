<script setup lang="ts">
import { computed } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import type { PromptInfoResponse } from "../support/PromptModels";
const props = defineProps<{
		response: PromptInfoResponse;
		tab: string;
		promptId: string;
		version: string;
		copied: Record<string, boolean>;
	}>(),
	emit = defineEmits<{ copy: [text: string, key: string] }>(),
	prompt = computed(() => props.response.prompt_spec),
	template = computed(() => props.response.raw_prompt_template);
function date(value?: string | null) {
	return value ? new Date(value).toLocaleString() : "-";
}
function json(value: unknown) {
	return JSON.stringify(value, null, 2);
}
</script>
<template>
	<div v-if="tab === 'overview'" class="prompt-detail-overview">
		<div class="prompt-detail-summary">
			<UiCard appearance="tremor"
				><p>Prompt ID</p>
				<h3 class="prompt-summary-id">{{ promptId }}</h3></UiCard
			><UiCard appearance="tremor"
				><p>Version</p>
				<h3>{{ version }}</h3>
				<UiTag appearance="tremor" color="blue">v{{ version }}</UiTag></UiCard
			><UiCard appearance="tremor"
				><p>Prompt Type</p>
				<h3>{{ prompt.prompt_info?.prompt_type || "-" }}</h3>
				<UiTag appearance="tremor" color="blue">{{ prompt.prompt_info?.prompt_type || "Unknown" }}</UiTag></UiCard
			><UiCard appearance="tremor"
				><p>Created At</p>
				<h3>{{ date(prompt.created_at) }}</h3>
				<p>Last Updated: {{ date(prompt.updated_at) }}</p></UiCard
			>
		</div>
		<UiCard v-if="Object.keys(prompt.litellm_params ?? {}).length" appearance="tremor" class="prompt-parameters-card"
			><label>LiteLLM Parameters</label>
			<pre>{{ json(prompt.litellm_params) }}</pre>
		</UiCard>
	</div>
	<UiCard v-else-if="tab === 'details'" appearance="tremor" class="prompt-admin-panel"
		><h3>Prompt Details</h3>
		<div>
			<section>
				<label>Prompt ID</label>
				<p class="prompt-detail-id">{{ promptId }}</p>
			</section>
			<section>
				<label>Prompt Type</label>
				<p>{{ prompt.prompt_info?.prompt_type || "-" }}</p>
			</section>
			<section>
				<label>Created At</label>
				<p>{{ date(prompt.created_at) }}</p>
			</section>
			<section>
				<label>Last Updated</label>
				<p>{{ date(prompt.updated_at) }}</p>
			</section>
			<section>
				<label>LiteLLM Parameters</label>
				<pre class="prompt-admin-parameters">{{ json(prompt.litellm_params) }}</pre>
			</section>
			<section>
				<label>Prompt Info</label>
				<pre>{{ json(prompt.prompt_info) }}</pre>
			</section>
		</div></UiCard
	><UiCard v-else-if="tab === 'template' && template" appearance="tremor" class="prompt-template-panel"
		><header>
			<h3>Prompt Template</h3>
			<UiButton
				variant="text"
				size="small"
				:class="{ copied: copied['prompt-content'] }"
				@click="emit('copy', template.content, 'prompt-content')"
				><UiLucideIcon :name="copied['prompt-content'] ? 'CheckIcon' : 'CopyIcon'" :size="16" />{{
					copied["prompt-content"] ? "Copied!" : "Copy Content"
				}}</UiButton
			>
		</header>
		<section>
			<label>Template ID</label>
			<p class="prompt-detail-id">{{ template.litellm_prompt_id }}</p>
		</section>
		<section>
			<label>Content</label>
			<pre class="prompt-template-content">{{ template.content }}</pre>
		</section>
		<section v-if="template.metadata && Object.keys(template.metadata).length">
			<label>Template Metadata</label>
			<pre class="prompt-template-metadata">{{ json(template.metadata) }}</pre>
		</section></UiCard
	><UiCard v-else-if="tab === 'raw'" appearance="tremor" class="prompt-raw-panel"
		><header>
			<h3>Raw API Response</h3>
			<UiButton variant="text" size="small" :class="{ copied: copied['raw-json'] }" @click="emit('copy', json(response), 'raw-json')"
				><UiLucideIcon :name="copied['raw-json'] ? 'CheckIcon' : 'CopyIcon'" :size="16" />{{
					copied["raw-json"] ? "Copied!" : "Copy JSON"
				}}</UiButton
			>
		</header>
		<pre>{{ json(response) }}</pre>
	</UiCard>
</template>
