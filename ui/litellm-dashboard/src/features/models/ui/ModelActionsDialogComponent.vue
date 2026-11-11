<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import ModelField from "./ModelFormFieldComponent.vue";
import ModelResourceDelete from "./ModelResourceDeleteDialogComponent.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { deploymentIconProps } from "../logic/ModelDataLogic";
import { modelsApi } from "../api/ModelsApi";
import { updateModelFallbacks } from "../logic/ModelFallbackLogic";
import { modelString, modelStrings, modelOptions, type DisplayProxyModel, type ModelCatalog } from "../support/ModelModels";
import notification from "../../notifications/logic/NotificationManager";
const props = defineProps<{
	mode: "fallback" | "override" | "settings" | "delete" | null;
	model: DisplayProxyModel | null;
	catalog: ModelCatalog;
	modelGroups: string[];
}>();
const emit = defineEmits<{ close: []; changed: [] }>();
const selected = ref<string[]>([]),
	override = ref(""),
	storeInDb = ref(false),
	loadingSettings = ref(false),
	storageDescription = ref("If enabled, models and config are stored in and loaded from the database."),
	pendingActions = ref(new Set<string>());
const actionIdentity = computed(() => `${props.mode}:${props.model?.model_info.id ?? props.model?.model_name ?? ""}`);
const pending = computed(() => pendingActions.value.has(actionIdentity.value));
function setPending(identity: string, value: boolean) {
	const next = new Set(pendingActions.value);
	if (value) next.add(identity);
	else next.delete(identity);
	pendingActions.value = next;
}
const title = computed(() =>
	props.mode === "fallback" ? "Edit Fallbacks" : props.mode === "override" ? "Edit Model Override" : "Model Settings",
);
let settingsRequest = 0;
watch(
	() => [props.mode, props.model] as const,
	async () => {
		selected.value = modelStrings(props.model?.model_info.fallbacks);
		override.value = modelString(props.model?.model_info.override_model_name);
		const request = ++settingsRequest;
		loadingSettings.value = props.mode === "settings";
		if (props.mode === "settings")
			try {
				const config = await modelsApi.fetchGeneralSettings();
				if (request !== settingsRequest) return;
				const field = config.find((item) => item.field_name === "store_model_in_db");
				storeInDb.value = Boolean(field?.field_value ?? false);
				storageDescription.value =
					modelString(field?.field_description) || "If enabled, models and config are stored in and loaded from the database.";
			} catch (error) {
				if (request === settingsRequest)
					notification.error(error instanceof Error ? error.message : "Failed to load model settings");
			} finally {
				if (request === settingsRequest) loadingSettings.value = false;
			}
	},
	{ immediate: true },
);
async function save() {
	if (pending.value || loadingSettings.value) return;
	const mode = props.mode,
		modelName = props.model?.model_name,
		modelId = props.model?.model_info.id,
		fallbacks = [...selected.value],
		nextOverride = override.value,
		nextStoreInDb = storeInDb.value;
	if (mode !== "settings" && mode !== "override" && mode !== "fallback") return;
	if ((mode === "override" && !modelId) || (mode === "fallback" && !modelName)) return;
	const identity = actionIdentity.value,
		request = settingsRequest;
	setPending(identity, true);
	try {
		if (mode === "settings") {
			await modelsApi.saveModelStorage(nextStoreInDb);
			notification.success("Model storage settings updated successfully");
		} else if (mode === "override" && modelId) {
			await modelsApi.patchModel(modelId, { model_info: { override_model_name: nextOverride || null } });
			notification.success(nextOverride ? `Model override set to ${nextOverride}` : "Model override removed");
		} else if (mode === "fallback" && modelName) {
			const current = await modelsApi.fetchCallbacks();
			await modelsApi.saveModelConfiguration({
				router_settings: updateModelFallbacks(current.router_settings, modelName, fallbacks),
			});
			notification.success("Fallbacks updated successfully");
		}
		emit("changed");
		if (request === settingsRequest) emit("close");
	} catch (error) {
		if (mode === "fallback") notification.fromBackend("Failed to update fallbacks: " + String(error));
		else if (mode === "override")
			notification.fromBackend("Failed to update model override: " + (error instanceof Error ? error.message : String(error)));
		else notification.fromBackend("Failed to save model storage settings: " + (error instanceof Error ? error.message : String(error)));
	} finally {
		setPending(identity, false);
	}
}
async function remove() {
	const id = props.model?.model_info.id;
	if (!id || pending.value) return;
	const identity = actionIdentity.value,
		request = settingsRequest;
	setPending(identity, true);
	try {
		await modelsApi.deleteModel(id);
		notification.success("Model deleted successfully");
		emit("changed");
		if (request === settingsRequest) emit("close");
	} catch (error) {
		notification.fromBackend(error instanceof Error ? error.message : "Failed to delete model");
	} finally {
		setPending(identity, false);
	}
}
</script>
<template>
	<ModelResourceDelete
		v-if="mode === 'delete'"
		:open="true"
		title="Delete Model"
		alert-message="This action cannot be undone."
		message="Are you sure you want to delete this model?"
		information-title="Model Information"
		:information="[
			{
				label: 'Model Name',
				value: model?.model_name || 'Not Set',
				model: model?.model_name ?? undefined,
				provider: model?.provider ?? undefined,
			},
			{
				label: 'LiteLLM Model Name',
				value: model?.litellm_model_name || 'Not Set',
				model: model?.litellm_model_name ?? undefined,
				provider: model?.provider,
			},
			{ label: 'Provider', value: model?.provider || 'Not Set', provider: model?.provider ?? undefined },
			{ label: 'Created By', value: model?.model_info.created_by || 'Not Set' },
		]"
		:pending="pending"
		@update:open="!$event && emit('close')"
		@confirm="remove"
	/>
	<UiDialog
		v-else
		:open="!!mode"
		:title="title"
		:width="520"
		:ok-text="mode === 'settings' ? 'Save Settings' : 'Save'"
		:confirm-loading="pending"
		scroll-mode="overlay"
		@update:open="!$event && emit('close')"
		@ok="save"
		><template v-if="mode === 'settings'">
			<ModelField label="Store Model in DB" :tooltip="storageDescription" class="model-storage-field model-switch-field">
				<UiSwitch v-model="storeInDb" :disabled="loadingSettings" aria-label="Store Model in DB" />
			</ModelField>
		</template>
		<template v-else>
			<div class="model-routing-action" :class="{ 'model-routing-action--fallback': mode === 'fallback' }">
				<div>
					<span class="model-routing-action__secondary">Model</span>
					<div>
						<ModelName
							v-if="model"
							class="model-routing-action__name"
							v-bind="deploymentIconProps(model)"
							:name="model.model_name"
							:size="16"
							variant="strong"
						/><span v-else class="model-routing-action__name">-</span>
					</div>
				</div>
				<div>
					<span class="model-routing-action__secondary">{{ mode === "fallback" ? "Fallback Models" : "Override Target" }}</span>
					<UiSelect
						v-if="mode === 'fallback'"
						v-model="selected"
						:options="modelOptions(modelGroups.filter((name) => name !== model?.model_name))"
						multiple
						searchable
						aria-label="Fallback Models"
						placeholder="Select fallback models"
					/>
					<UiSelect
						v-else
						v-model="override"
						:options="modelOptions(modelGroups.filter((name) => name !== model?.model_name))"
						searchable
						clearable
						aria-label="Override Target"
						placeholder="No override"
					/>
				</div>
				<span v-if="mode === 'fallback'" class="model-routing-action__secondary">
					When this model fails, the proxy retries the selected fallbacks in order. Leave empty to remove the fallback entry for
					this model.
				</span>
				<span v-else class="model-routing-action__secondary">
					All requests for this model are forced to the target before the first attempt, then fall back along the chain configured
					on the target. Clear the selection to restore normal routing.
				</span>
			</div>
		</template>
		<template v-if="mode === 'settings'" #footer>
			<UiButton :disabled="pending || loadingSettings" @click="emit('close')">Cancel</UiButton>
			<UiButton variant="primary" :loading="pending" :disabled="loadingSettings" @click="save">{{
				pending ? "Saving..." : "Save Settings"
			}}</UiButton>
		</template>
	</UiDialog>
</template>

<style scoped>
.model-routing-action {
	display: flex;
	flex-direction: column;
	gap: 16px;
	margin-top: 8px;
}
.model-routing-action strong {
	font-weight: 600;
}
.model-routing-action__secondary {
	font-size: 12px;
	line-height: 16px;
	color: rgb(0 0 0 / 0.45);
}
.model-routing-action--fallback .model-routing-action__secondary {
	line-height: 1.5714285714285714;
}
</style>

<style scoped>
.model-storage-field :deep(.model-field__label) {
	flex: none;
	max-width: none;
	padding-right: 0;
	gap: 0;
}
.model-storage-field :deep(.ui-popover-anchor) {
	margin-left: 4px;
}
.model-storage-field :deep(.model-field__colon) {
	margin-inline: 2px 8px;
}
</style>
