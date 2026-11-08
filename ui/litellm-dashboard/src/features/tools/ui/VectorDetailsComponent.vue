<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import AccessFieldComponent from "../../access-control/ui/AccessFieldComponent.vue";
import AccessHeroIconComponent from "../../access-control/ui/AccessHeroIconComponent.vue";
import VectorTesterComponent from "./VectorTesterComponent.vue";
import { vectorStoresApi } from "../api/VectorStoresApi";
import { vectorPayload } from "../logic/VectorDraftLogic";
import { getProviderLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
import type { VectorStore, VectorCredential } from "../support/VectorStoreModels";
const props = defineProps<{ id: string; edit?: boolean; admin: boolean }>();
const emit = defineEmits<{ close: []; notice: [message: string]; error: [message: string] }>();
const record = ref<VectorStore | null>(null),
	editing = ref(Boolean(props.edit)),
	draft = ref<Record<string, unknown>>({}),
	metadata = ref("{}"),
	tab = ref("details"),
	credentials = ref<VectorCredential[]>([]),
	pending = ref(false);
const controller = new AbortController();
async function load() {
	try {
		const value = await vectorStoresApi.detail(props.id, controller.signal);
		record.value = value;
		metadata.value = JSON.stringify(value.vector_store_metadata || {}, null, 2);
		draft.value = { ...value };
	} catch (error) {
		emit("error", "Error fetching vector store details: " + String(error));
	}
}
async function save() {
	let body: Record<string, unknown>;
	try {
		body = vectorPayload(draft.value, metadata.value, true);
	} catch {
		emit("error", "Invalid JSON in metadata field");
		return;
	}
	pending.value = true;
	try {
		await vectorStoresApi.update(body);
		emit("notice", "Vector store updated successfully");
		editing.value = false;
		await load();
	} catch (error) {
		emit("error", "Error updating vector store: " + String(error));
	} finally {
		pending.value = false;
	}
}
onMounted(() => {
	void load();
	void vectorStoresApi.credentials().then((value) => {
		credentials.value = value;
	});
});
onBeforeUnmount(() => controller.abort());
const metadataExample = JSON.stringify({ key: "value" });
function providerOptionLogo(option?: { value?: string | number; label?: string }) {
	return getProviderLogoAndName(String(option?.value ?? "bedrock")).logo;
}
function providerOptionLabel(option?: { value?: string | number; label?: string }) {
	return option?.label ?? "Amazon Bedrock";
}
</script>
<template>
	<p v-if="!record">Loading...</p>
	<section v-else class="tools-vector-details">
		<header>
			<div>
				<UiButton appearance="tremor" variant="link" @click="$emit('close')"
					><template #icon><AccessHeroIconComponent name="ArrowLeft" /></template>Back to Vector Stores</UiButton
				>
				<h3>Vector Store ID: {{ record.vector_store_id }}</h3>
				<p>{{ record.vector_store_description || "No description" }}</p>
			</div>
			<UiButton v-if="admin && !editing" appearance="tremor" variant="primary" @click="editing = true">Edit Vector Store</UiButton>
		</header>
		<UiTabs
			v-model="tab"
			appearance="tremor"
			:items="[
				{ key: 'details', label: 'Details' },
				{ key: 'test', label: 'Test Vector Store' },
			]"
		/><VectorTesterComponent
			v-if="tab === 'test'"
			:id="record.vector_store_id"
			@error="$emit('error', $event)"
			@notice="$emit('notice', $event)"
		/>
		<div v-else>
			<header class="tools-vector-detail-section-title">
				<h3>{{ editing ? "Edit Vector Store" : "Vector Store Details" }}</h3>
				<UiButton v-if="admin && !editing" appearance="tremor" variant="primary" @click="editing = true"
					>Edit Vector Store</UiButton
				>
			</header>
			<UiCard v-if="editing"
				><form @submit.prevent="save">
					<AccessFieldComponent
						v-model="draft.vector_store_id"
						name="vector-edit-id"
						label="Vector Store ID"
						required
						disabled
					/><AccessFieldComponent
						v-model="draft.vector_store_name"
						name="vector-edit-name"
						label="Vector Store Name"
					/><AccessFieldComponent
						v-model="draft.vector_store_description"
						name="vector-edit-description"
						label="Description"
						type="textarea"
					/><AccessFieldComponent
						v-model="draft.custom_llm_provider"
						name="vector-edit-provider"
						label="Provider"
						type="select"
						:options="[{ value: 'bedrock', label: 'Amazon Bedrock' }]"
						required
						tooltip="Select the provider for this vector store"
						tooltip-icon="InfoCircleOutlined"
						><template #value="{ option }"
							><span class="tools-vector-provider-option"
								><img v-if="providerOptionLogo(option)" :src="providerOptionLogo(option)" alt="" /><span>{{
									providerOptionLabel(option)
								}}</span></span
							></template
						><template #option="{ option }"
							><span class="tools-vector-provider-option"
								><img v-if="providerOptionLogo(option)" :src="providerOptionLogo(option)" alt="" /><span>{{
									providerOptionLabel(option)
								}}</span></span
							></template
						></AccessFieldComponent
					>
					<p class="tools-vector-credential-hint">Either select existing credentials OR enter provider credentials below</p>
					<AccessFieldComponent
						v-model="draft.litellm_credential_name"
						name="vector-edit-credentials"
						label="Existing Credentials"
						type="select"
						:options="[
							{ value: '', label: 'None' },
							...credentials.map((item) => ({ value: item.credential_name, label: item.credential_name })),
						]"
						placeholder="Select or search for existing credentials"
					/>
					<div class="tools-vector-or"><span>OR</span></div>
					<AccessFieldComponent
						v-model="metadata"
						name="vector-edit-metadata"
						label="Metadata"
						tooltip="JSON metadata for the vector store"
						tooltip-icon="InfoCircleOutlined"
						type="textarea"
						:placeholder="metadataExample"
					/>
					<footer class="tools-form-footer">
						<UiButton @click="editing = false">Cancel</UiButton
						><UiButton type="submit" variant="primary" :loading="pending">Save Changes</UiButton>
					</footer>
				</form></UiCard
			><UiCard v-else
				><dl class="tools-vector-definition">
					<dt>ID</dt>
					<dd>{{ record.vector_store_id }}</dd>
					<dt>Name</dt>
					<dd>{{ record.vector_store_name || "-" }}</dd>
					<dt>Description</dt>
					<dd>{{ record.vector_store_description || "-" }}</dd>
					<dt>Provider</dt>
					<dd class="tools-tags">
						<img
							v-if="getProviderLogoAndName(record.custom_llm_provider || 'bedrock').logo"
							:src="getProviderLogoAndName(record.custom_llm_provider || 'bedrock').logo"
							alt=""
							width="20"
							height="20"
						/><UiTag appearance="tremor" color="blue">{{
							getProviderLogoAndName(record.custom_llm_provider || "bedrock").displayName
						}}</UiTag>
					</dd>
					<dt>Metadata</dt>
					<dd>
						<pre>{{ metadata }}</pre>
					</dd>
					<dt>Created</dt>
					<dd>{{ record.created_at ? new Date(record.created_at).toLocaleString() : "-" }}</dd>
					<dt>Last Updated</dt>
					<dd>{{ record.updated_at ? new Date(record.updated_at).toLocaleString() : "-" }}</dd>
				</dl></UiCard
			>
		</div>
	</section>
</template>
