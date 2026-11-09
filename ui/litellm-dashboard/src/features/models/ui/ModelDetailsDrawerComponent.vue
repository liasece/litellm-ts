<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { copyText } from "../../content/logic/ClipboardLogic";
import UiDrawer from "../../platform/ui/UiDrawer.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import ModelSettingsGrid from "./ModelSettingsGridComponent.vue";
import ModelEditDialog from "./ModelEditDialogComponent.vue";
import ModelResourceDelete from "./ModelResourceDeleteDialogComponent.vue";
import ModelOverview from "./ModelOverviewComponent.vue";
import ModelAutoRouterEditDialog from "./ModelAutoRouterEditDialogComponent.vue";
import ModelField from "./ModelFormFieldComponent.vue";
import { modelsApi } from "../api/ModelsApi";
import { normalizeModelDetails, modelDisplayName } from "../logic/ModelDataLogic";
import { createModelEditDraft } from "../logic/ModelEditLogic";
import { type ModelCatalog, type DisplayProxyModel, type ModelCredential, type ProxyModel } from "../support/ModelModels";
import notification from "../../notifications/logic/NotificationManager";
const props = defineProps<{ modelId: string; catalog: ModelCatalog; role: string; userId: string }>();
const emit = defineEmits<{ close: []; updated: [model: DisplayProxyModel | null] }>();
const model = ref<DisplayProxyModel | null>(null),
	raw = ref<unknown>(null),
	loading = ref(false),
	editOpen = ref(false),
	deleteOpen = ref(false),
	reuseOpen = ref(false),
	autoOpen = ref(false),
	tab = ref("overview"),
	pending = ref(false),
	copied = ref(false),
	credential = ref<ModelCredential | null>(null),
	credentialName = ref(""),
	credentialError = ref(""),
	readDraft = ref<Record<string, unknown>>({});
let generation = 0,
	disposed = false,
	copyTimer: ReturnType<typeof setTimeout> | undefined;
const canEdit = computed(
	() => !!model.value?.model_info.db_model && (props.role === "Admin" || model.value.model_info.created_by === props.userId),
);
const usingCredential = computed(() => !!model.value?.litellm_params.litellm_credential_name);
async function load() {
	const current = ++generation;
	loading.value = true;
	raw.value = null;
	try {
		const result = await modelsApi.listModels({ page: 1, size: 50, modelId: props.modelId });
		let source: ProxyModel | undefined = result.data[0];
		if (!source) source = await modelsApi.fetchModelInfo(props.modelId);
		if (disposed || current !== generation) return;
		model.value = source ? normalizeModelDetails(source) : null;
		readDraft.value = source ? createModelEditDraft(source) : {};
		if (source && !source.litellm_params.litellm_credential_name)
			void modelsApi
				.fetchCredential(null, props.modelId)
				.then((value) => {
					if (!disposed && current === generation) {
						credential.value = value;
						credentialName.value = value.credential_name;
					}
				})
				.catch(() => undefined);
		void modelsApi
			.fetchRawModel(props.modelId)
			.then((value) => {
				if (!disposed && current === generation) raw.value = value;
			})
			.catch(() => undefined);
	} catch (error) {
		if (!disposed && current === generation) notification.fromBackend(error instanceof Error ? error.message : "Model not found");
	} finally {
		if (!disposed && current === generation) loading.value = false;
	}
}
watch(
	() => props.modelId,
	() => {
		editOpen.value = false;
		tab.value = "overview";
		credential.value = null;
		void load();
	},
	{ immediate: true },
);
async function copy() {
	try {
		await copyText(props.modelId);
		copied.value = true;
		if (copyTimer) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied.value = false), 2000);
	} catch {
		/* Preserve native clipboard failure without exposing data. */
	}
}
function updated(value: DisplayProxyModel) {
	model.value = value;
	readDraft.value = createModelEditDraft(value);
	raw.value = value;
	emit("updated", value);
}
async function remove() {
	pending.value = true;
	try {
		await modelsApi.deleteModel(props.modelId);
		notification.success("Model deleted successfully");
		emit("updated", null);
		emit("close");
	} catch {
		notification.fromBackend("Failed to delete model");
	} finally {
		pending.value = false;
		deleteOpen.value = false;
	}
}
async function reuse() {
	if (!model.value || !credential.value || usingCredential.value) return;
	const name = credentialName.value.trim();
	if (!name) {
		credentialError.value = "Enter a credential name";
		return;
	}
	pending.value = true;
	try {
		await modelsApi.saveCredential({
			credential_name: name,
			model_id: props.modelId,
			attach_to_model: true,
			credential_info: { custom_llm_provider: model.value.litellm_params.custom_llm_provider },
		});
		notification.info("Storing credential..");
		const result = await modelsApi.listModels({ page: 1, size: 50, modelId: props.modelId });
		if (result.data[0]) updated(normalizeModelDetails(result.data[0]));
		notification.success("Stored credential successfully");
		reuseOpen.value = false;
	} catch (error) {
		notification.fromBackend(error instanceof Error ? error.message : "Failed to store credential");
	} finally {
		pending.value = false;
	}
}
onBeforeUnmount(() => {
	disposed = true;
	generation++;
	if (copyTimer) clearTimeout(copyTimer);
});
</script>
<template>
	<UiDrawer
		:open="true"
		:title="model ? 'Model: ' + modelDisplayName(model) : 'Model'"
		width="clamp(50vw, 1200px, 80vw)"
		class="model-details-drawer"
		@update:open="!$event && emit('close')"
		><template #title>
			<span class="model-drawer-heading"
				><span class="model-drawer-title"
					>{{ model ? "Model: " + modelDisplayName(model) : "Model" }}<small>{{ modelId }}</small></span
				><span v-if="canEdit" class="model-drawer-actions"
					><UiButton variant="primary" @click="editOpen = true">Edit</UiButton></span
				></span
			>
		</template>
		<div v-if="loading" class="model-text">Loading...</div>
		<div v-else-if="!model" class="model-text">Model not found</div>
		<div v-else class="model-details-content">
			<header class="model-details-heading">
				<div>
					<h3 class="model-title">Public Model Name: {{ modelDisplayName(model) }}</h3>
					<div class="model-inline model-details-id">
						<span>{{ modelId }}</span
						><UiButton variant="text" size="small" aria-label="Copy model ID" :class="{ 'model-copied': copied }" @click="copy"
							><template #icon><UiLucideIcon :name="copied ? 'Check' : 'Copy'" :size="12" /></template
						></UiButton>
					</div>
				</div>
				<div class="model-details-actions">
					<UiButton
						appearance="tremor"
						data-testid="reuse-credentials-button"
						:disabled="role !== 'Admin'"
						@click="
							reuseOpen = true;
							credentialError = '';
						"
						><template #icon><UiHeroIcon name="KeyIcon" /></template>Re-use Credentials</UiButton
					><UiButton
						appearance="tremor"
						data-testid="delete-model-button"
						class="model-detail-delete"
						:disabled="!canEdit"
						@click="deleteOpen = true"
						><template #icon><UiHeroIcon name="TrashIcon" /></template>Delete Model</UiButton
					>
				</div>
			</header>
			<UiTabs
				v-model="tab"
				appearance="tremor"
				:items="[
					{ key: 'overview', label: 'Overview' },
					{ key: 'raw', label: 'Raw JSON' },
				]"
				><template v-if="tab === 'overview'"
					><ModelOverview :model="model" /><UiCard :padding="12" class="model-settings-card"
						><div class="model-inline model-between model-settings-heading">
							<h3 class="model-title">Model Settings</h3>
							<UiButton
								v-if="model.litellm_params.auto_router_config != null && canEdit"
								appearance="tremor"
								variant="primary"
								@click="autoOpen = true"
								>Edit Auto Router</UiButton
							>
						</div>
						<ModelSettingsGrid
							v-model="readDraft"
							:model="model"
							:catalog="catalog"
							:model-names="catalog.models"
							:editing="false" /></UiCard></template
				><UiCard v-else :padding="12"
					><details class="model-complete-json">
						<summary>Expand complete model JSON</summary>
						<pre>{{ JSON.stringify(raw ?? model, null, 2) }}</pre>
					</details></UiCard
				></UiTabs
			>
			<ModelEditDialog
				v-if="editOpen"
				v-model:open="editOpen"
				:model="model"
				:catalog="catalog"
				:model-names="catalog.models"
				@updated="updated"
			/><ModelAutoRouterEditDialog
				v-if="autoOpen"
				v-model:open="autoOpen"
				:model="model"
				:catalog="catalog"
				:admin="role === 'Admin'"
				@updated="updated"
			/>
			<ModelResourceDelete
				v-model:open="deleteOpen"
				title="Delete Model"
				alert-message="This action cannot be undone."
				message="Are you sure you want to delete this model?"
				information-title="Model Information"
				:information="[
					{ label: 'Model Name', value: model.model_name || 'Not Set' },
					{ label: 'LiteLLM Model Name', value: model.litellm_model_name || 'Not Set' },
					{ label: 'Provider', value: model.provider || 'Not Set' },
					{ label: 'Created By', value: model.model_info.created_by || 'Not Set' },
				]"
				:pending="pending"
				@confirm="remove"
			/>
			<UiDialog
				v-model:open="reuseOpen"
				:title="usingCredential ? 'Using Existing Credential' : 'Reuse Credentials'"
				:width="usingCredential ? 520 : 600"
				scroll-mode="overlay"
				:show-footer="usingCredential"
				><p v-if="usingCredential">{{ model.litellm_params.litellm_credential_name }}</p>
				<form v-else class="model-reuse-credential" @submit.prevent="reuse">
					<ModelField label="New Credential Name" vertical required :error="credentialError"
						><UiInput v-model="credentialName" autocomplete="off"
					/></ModelField>
					<p>A new credential with this name will be created and bound to the model.</p>
					<dl>
						<dt>Credential Name</dt>
						<dd>{{ credential?.credential_name ?? "Not available" }}</dd>
						<dt>Provider</dt>
						<dd>{{ credential?.credential_info.custom_llm_provider ?? "Not set" }}</dd>
						<dt>Configured Fields</dt>
						<dd>
							<ul v-if="Object.keys(credential?.credential_values ?? {}).length">
								<li v-for="key in Object.keys(credential?.credential_values ?? {})" :key="key">{{ key }}</li>
							</ul>
							<span v-else>None</span>
						</dd>
					</dl>
					<div class="model-form-footer">
						<a href="https://github.com/BerriAI/litellm/issues" target="_blank" rel="noreferrer">Need Help?</a>
						<div>
							<UiButton @click="reuseOpen = false">Cancel</UiButton
							><UiButton type="submit" :disabled="!credential" :loading="pending">Reuse Credentials</UiButton>
						</div>
					</div>
				</form></UiDialog
			>
		</div></UiDrawer
	>
</template>
