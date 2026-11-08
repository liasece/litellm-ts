<script setup lang="ts">
import { onBeforeUnmount } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import AccessFieldComponent from "../../access-control/ui/AccessFieldComponent.vue";
import AccessNoticeComponent from "../../access-control/ui/AccessNoticeComponent.vue";
import VectorProviderFieldsComponent from "./VectorProviderFieldsComponent.vue";
import { VectorStoreProviders, vectorStoreProviderMap, vectorStoreProviderLogoMap } from "../support/VectorProviderSupport";
import { createVectorIngestStore } from "../stores/VectorIngestStore";
import { formatVectorFileSize } from "../logic/VectorDraftLogic";
import type { EmbeddingModel, VectorUpload } from "../support/VectorStoreModels";
defineProps<{ models: EmbeddingModel[] }>();
const emit = defineEmits<{ created: [id: string] }>();
const store = createVectorIngestStore(),
	{ documents, results, state } = store;
function add(event: Event) {
	const input = event.target;
	if (input instanceof HTMLInputElement && input.files) {
		store.add(Array.from(input.files));
		input.value = "";
	}
}
function drop(event: DragEvent) {
	if (event.dataTransfer) store.add(Array.from(event.dataTransfer.files));
}
function doc(row: Record<string, unknown>) {
	return row as VectorUpload;
}
async function create() {
	const id = await store.create();
	if (id) emit("created", id);
}
async function copy(id: string) {
	await navigator.clipboard.writeText(id);
	state.message = "Document ID copied to clipboard";
}
onBeforeUnmount(store.dispose);
</script>
<template>
	<section class="tools-vector-ingest">
		<AccessNoticeComponent :error="state.error" :message="state.message" />
		<header>
			<h3>Create Vector Store</h3>
			<p>Upload documents and select a provider to create a new vector store with embedded content.</p>
		</header>
		<UiCard
			><div class="tools-vector-card-intro">
				<strong>Step 1: Upload Documents</strong>
				<p>Upload one or more documents (PDF, TXT, DOCX, MD). Maximum file size: 50MB per file.</p>
			</div>
			<label class="tools-vector-drop" @dragover.prevent @drop.prevent="drop"
				><input type="file" multiple accept=".pdf,.txt,.docx,.md,.doc" @change="add" /><UiIcon
					name="InboxOutlined"
					:size="48"
				/><strong>Click or drag files to this area to upload</strong
				><span>Support for single or bulk upload. Supported formats: PDF, TXT, DOCX, MD</span></label
			></UiCard
		><UiCard v-if="documents.length"
			><div class="tools-vector-card-intro">
				<strong>Uploaded Documents ({{ documents.length }})</strong>
			</div>
			<UiTable
				:columns="[
					{ key: 'name', label: 'Name' },
					{ key: 'status', label: 'Status', width: 150 },
					{ key: 'actions', label: 'Actions', width: 120 },
				]"
				:rows="documents"
				row-key="uid"
				compact
				><template #cell-name="{ row }"
					>{{ doc(row).name }} <small v-if="doc(row).size">({{ formatVectorFileSize(doc(row).size) }})</small></template
				><template #cell-status="{ row }"
					><span class="tools-vector-file-status" :class="'tools-vector-file-status--' + doc(row).status">{{
						{ done: "Ready", uploading: "Uploading", error: "Error", removed: "Removed" }[doc(row).status]
					}}</span></template
				><template #cell-actions="{ row }"
					><div class="tools-tags">
						<button type="button" class="tools-copy" title="View details"><UiIcon name="EyeOutlined" /></button
						><button type="button" class="tools-copy" title="Copy ID" @click="copy(doc(row).uid)">
							<UiIcon name="CopyOutlined" /></button
						><button type="button" class="tools-copy" title="Remove" @click="store.remove(doc(row).uid)">
							<UiIcon name="DeleteOutlined" />
						</button></div></template></UiTable></UiCard
		><UiCard
			><div class="tools-vector-card-intro">
				<strong>Step 2: Configure Vector Store</strong>
				<p>Choose the provider and optionally provide a name and description for your vector store.</p>
			</div>
			<form class="tools-vector-ingest-form" @submit.prevent="create">
				<AccessFieldComponent
					size="large"
					tooltip-icon="InfoCircleOutlined"
					v-model="state.name"
					name="ingest-name"
					label="Vector Store Name"
					tooltip="Optional: Give your vector store a meaningful name"
					placeholder="e.g., Product Documentation, Customer Support KB"
				/><AccessFieldComponent
					size="large"
					tooltip-icon="InfoCircleOutlined"
					v-model="state.description"
					name="ingest-description"
					label="Description"
					tooltip="Optional: Describe what this vector store contains"
					type="textarea"
					:rows="2"
					placeholder="e.g., Contains all product documentation and user guides"
				/><AccessFieldComponent
					size="large"
					tooltip-icon="InfoCircleOutlined"
					v-model="state.provider"
					name="ingest-provider"
					label="Provider"
					tooltip="Select the provider for embedding and vector store operations"
					type="select"
					:options="Object.entries(VectorStoreProviders).map(([key, label]) => ({ value: vectorStoreProviderMap[key], label }))"
					placeholder="Select a provider"
					required
					:searchable="false"
					:clearable="false"
					><template #value="{ option }"
						><span class="tools-vector-provider-label"
							><img :src="vectorStoreProviderLogoMap[option.label]" alt="" />{{ option.label }}</span
						></template
					><template #option="{ option }"
						><span class="tools-vector-provider-label"
							><img :src="vectorStoreProviderLogoMap[option.label]" alt="" />{{ option.label }}</span
						></template
					></AccessFieldComponent
				><VectorProviderFieldsComponent v-model="state.params" :provider="state.provider" :models="models" ingesting />
				<footer class="tools-form-footer">
					<UiButton
						type="submit"
						variant="primary"
						size="large"
						:loading="state.pending"
						:disabled="!documents.length || !state.provider"
						>{{ state.pending ? "Creating Vector Store..." : "Create Vector Store" }}</UiButton
					>
				</footer>
			</form></UiCard
		><UiAlert v-if="results.length" title="Vector Store Created Successfully" type="success" show-icon closable
			><p><strong>Vector Store ID:</strong> {{ results[0]?.vector_store_id }}</p>
			<p><strong>Documents Ingested:</strong> {{ results.length }}</p></UiAlert
		>
	</section>
</template>
