<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import AccessFieldComponent from "../../access-control/ui/AccessFieldComponent.vue";
import VectorProviderFieldsComponent from "./VectorProviderFieldsComponent.vue";
import {
	VectorStoreProviders,
	vectorStoreProviderMap,
	vectorStoreProviderLogoMap,
	getProviderSpecificFields,
} from "../support/VectorProviderSupport";
import { vectorPayload } from "../logic/VectorDraftLogic";
import { vectorStoresApi } from "../api/VectorStoresApi";
import type { VectorCredential, EmbeddingModel } from "../support/VectorStoreModels";
const open = defineModel<boolean>("open", { required: true });
defineProps<{ credentials: VectorCredential[]; models: EmbeddingModel[] }>();
const emit = defineEmits<{ saved: []; error: [message: string] }>();
const draft = ref<Record<string, unknown>>({ custom_llm_provider: "bedrock" }),
	metadata = ref("{}"),
	errors = ref<Record<string, string>>({}),
	pending = ref(false);
const options = Object.entries(VectorStoreProviders).map(([key, label]) => ({ value: vectorStoreProviderMap[key], label })),
	provider = computed(() => String(draft.value.custom_llm_provider || ""));
watch(open, (value) => {
	if (value) {
		draft.value = { custom_llm_provider: "bedrock" };
		metadata.value = "{}";
		errors.value = {};
	}
});
async function submit() {
	errors.value = {};
	if (!draft.value.vector_store_id) errors.value.vector_store_id = "Please input the vector store ID from your api provider";
	for (const field of getProviderSpecificFields(provider.value))
		if (field.required && !draft.value[field.name])
			errors.value[field.name] = `Please ${field.type === "select" ? "select" : "input"} the ${field.label.toLowerCase()}`;
	if (Object.keys(errors.value).length) return;
	let payload: Record<string, unknown>;
	try {
		payload = vectorPayload(draft.value, metadata.value);
	} catch {
		emit("error", "Invalid JSON in metadata field");
		return;
	}
	pending.value = true;
	try {
		await vectorStoresApi.create(payload);
		emit("saved");
		open.value = false;
	} catch (error) {
		emit("error", "Error creating vector store: " + String(error));
	} finally {
		pending.value = false;
	}
}
const metadataExample = JSON.stringify({ key: "value" });
function providerLogo(option?: { value?: string | number; label?: string }) {
	return option?.label ? (vectorStoreProviderLogoMap[option.label] ?? "") : "";
}
</script>
<template>
	<UiDialog scroll-mode="overlay" v-model:open="open" title="Add New Vector Store" :width="1000" :show-footer="false"
		><form class="tools-vector-register-form" @submit.prevent="submit">
			<AccessFieldComponent
				v-model="draft.custom_llm_provider"
				name="vector-provider"
				label="Provider"
				tooltip="Select the provider for this vector store"
				type="select"
				:options="options"
				required
				horizontal
				tooltip-icon="InfoCircleOutlined"
				><template #value="{ option }"
					><span class="tools-vector-provider-option"
						><img v-if="providerLogo(option)" :src="providerLogo(option)" alt="" /><span>{{ option?.label ?? "" }}</span></span
					></template
				><template #option="{ option }"
					><span class="tools-vector-provider-option"
						><img v-if="providerLogo(option)" :src="providerLogo(option)" alt="" /><span>{{ option?.label ?? "" }}</span></span
					></template
				></AccessFieldComponent
			><AccessFieldComponent
				v-model="draft.vector_store_id"
				name="vector-id"
				label="Vector Store ID"
				tooltip="Enter the vector store ID from your api provider"
				:placeholder="
					provider === 'vertex_rag_engine'
						? '6917529027641081856 (Get corpus ID from Vertex AI console)'
						: 'Enter vector store ID from your provider'
				"
				required
				horizontal
				input-appearance="tremor"
				tooltip-icon="InfoCircleOutlined"
				:error="errors.vector_store_id"
			/><VectorProviderFieldsComponent v-model="draft" :provider="provider" :models="models" :errors="errors" /><AccessFieldComponent
				v-model="draft.vector_store_name"
				name="vector-name"
				label="Vector Store Name"
				tooltip="Custom name you want to give to the vector store, this name will be rendered on the LiteLLM UI"
				horizontal
				input-appearance="tremor"
				placeholder="Type..."
				tooltip-icon="InfoCircleOutlined"
			/><AccessFieldComponent
				v-model="draft.vector_store_description"
				name="vector-description"
				label="Description"
				type="textarea"
				horizontal
				tooltip-icon="InfoCircleOutlined"
			/><AccessFieldComponent
				v-model="draft.litellm_credential_name"
				name="vector-credentials"
				label="Existing Credentials"
				tooltip="Optionally select API provider credentials for this vector store eg. Bedrock API KEY"
				type="select"
				:options="[
					{ value: '', label: 'None' },
					...credentials.map((item) => ({ value: item.credential_name, label: item.credential_name })),
				]"
				placeholder="Select or search for existing credentials"
				horizontal
				tooltip-icon="InfoCircleOutlined"
			/><AccessFieldComponent
				v-model="metadata"
				name="vector-metadata"
				label="Metadata"
				tooltip="JSON metadata for the vector store (optional)"
				type="textarea"
				:placeholder="metadataExample"
				horizontal
				tooltip-icon="InfoCircleOutlined"
			/>
			<footer class="tools-form-footer">
				<UiButton appearance="tremor" @click="open = false">Cancel</UiButton
				><UiButton type="submit" appearance="tremor" variant="primary" :loading="pending">Create</UiButton>
			</footer>
		</form></UiDialog
	>
</template>
