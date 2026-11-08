<script setup lang="ts">
import { computed } from "vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiFormField from "../../platform/ui/UiFormField.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { getProviderSpecificFields } from "../support/VectorProviderSupport";
import type { EmbeddingModel } from "../support/VectorStoreModels";
const draft = defineModel<Record<string, unknown>>({ required: true });
const props = defineProps<{ provider: string; models: EmbeddingModel[]; ingesting?: boolean; errors?: Record<string, string> }>();
const fields = computed(() => getProviderSpecificFields(props.provider));
function str(value: unknown) {
	return typeof value === "string" ? value : "";
}
</script>
<template>
	<UiAlert v-if="provider === 'pg_vector'" title="PG Vector Setup Required" type="info" show-icon class="tools-vector-provider-info"
		><p>LiteLLM provides a server to connect to PG Vector. To use this provider:</p>
		<ol>
			<li>
				Deploy the litellm-pgvector server from:
				<a href="https://github.com/BerriAI/litellm-pgvector" target="_blank" rel="noopener noreferrer"
					>https://github.com/BerriAI/litellm-pgvector</a
				>
			</li>
			<li>Configure your PostgreSQL database with pgvector extension</li>
			<li>Start the server and note the API base URL and API key</li>
			<li>Enter those details in the fields below</li>
		</ol></UiAlert
	><UiAlert
		v-if="provider === 'vertex_rag_engine'"
		title="Vertex AI RAG Engine Setup"
		type="info"
		show-icon
		class="tools-vector-provider-info"
		><p>To use Vertex AI RAG Engine:</p>
		<ol>
			<li>
				Set up your Vertex AI RAG Engine corpus following the guide:
				<a
					href="https://cloud.google.com/vertex-ai/generative-ai/docs/rag-engine/rag-overview"
					target="_blank"
					rel="noopener noreferrer"
					>Vertex AI RAG Engine Overview</a
				>
			</li>
			<li>Create a corpus in your Google Cloud project</li>
			<li>Note the corpus ID from the Vertex AI console</li>
			<li>Enter the corpus ID in the Vector Store ID field below</li>
		</ol></UiAlert
	><UiAlert
		v-if="ingesting && provider === 's3_vectors'"
		title="AWS S3 Vectors Setup"
		type="info"
		show-icon
		class="tools-vector-provider-info"
		><p>AWS S3 Vectors allows you to store and query vector embeddings directly in S3:</p>
		<ul>
			<li>Vector buckets and indexes will be automatically created if they don't exist</li>
			<li>Vector dimensions are auto-detected from your selected embedding model</li>
			<li>Ensure your AWS credentials have permissions for S3 Vectors operations</li>
			<li>
				Learn more:
				<a
					href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vector-buckets.html"
					target="_blank"
					rel="noopener noreferrer"
					>AWS S3 Vectors Documentation</a
				>
			</li>
		</ul></UiAlert
	><UiFormField
		v-for="field in fields"
		:key="field.name"
		:for="'vector-' + field.name"
		:label="field.label"
		:required="field.required"
		:horizontal="!ingesting"
		:error="
			errors?.[field.name] ||
			(ingesting &&
			provider === 's3_vectors' &&
			['vector_bucket_name', 'index_name'].includes(field.name) &&
			str(draft[field.name]) &&
			str(draft[field.name]).length < 3
				? field.name === 'index_name'
					? 'Index name must be at least 3 characters if provided'
					: 'Bucket name must be at least 3 characters'
				: undefined)
		"
		><template #label
			>{{ field.label }} <UiTooltip :title="field.tooltip"><UiIcon name="InfoCircleOutlined" /></UiTooltip></template
		><UiSelect
			v-if="field.type === 'select' && (!ingesting || provider === 's3_vectors')"
			:id="'vector-' + field.name"
			:model-value="str(draft[field.name]) || undefined"
			searchable
			:size="ingesting ? 'large' : 'middle'"
			:options="
				models
					.filter((model) => model.mode === 'embedding' || (!ingesting && model.mode === null))
					.map((model) => ({ value: model.model_group, label: model.model_group }))
			"
			:placeholder="ingesting && provider === 's3_vectors' ? 'Select an embedding model' : field.placeholder"
			@update:model-value="draft[field.name] = $event" /><UiInput
			v-else
			:id="'vector-' + field.name"
			:model-value="str(draft[field.name])"
			:type="field.type === 'password' ? 'password' : 'text'"
			:size="ingesting ? 'large' : 'middle'"
			:appearance="ingesting ? 'antd' : 'tremor'"
			:placeholder="field.placeholder"
			@update:model-value="draft[field.name] = $event"
	/></UiFormField>
</template>
