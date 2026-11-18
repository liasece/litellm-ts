<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiDragHandle from "../../platform/ui/UiDragHandle.vue";
import UiEntryCard from "../../platform/ui/UiEntryCard.vue";
import UiEntryRemove from "../../platform/ui/UiEntryRemove.vue";
import UiSortableList from "../../platform/ui/UiSortableList.vue";
import UiSectionCard from "../../platform/ui/UiSectionCard.vue";
import UiSwitchRow from "../../platform/ui/UiSwitchRow.vue";
import ModelField from "./ModelFormFieldComponent.vue";
import ModelResourceDelete from "./ModelResourceDeleteDialogComponent.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { deploymentIconProps } from "../logic/ModelDataLogic";
import { modelsApi } from "../api/ModelsApi";
import { modelFallbackEntry, updateModelFallbacks } from "../logic/ModelFallbackLogic";
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
	recurse = ref(true),
	loadingFallbacks = ref(false),
	override = ref(""),
	storeInDb = ref(false),
	loadingSettings = ref(false),
	storageDescription = ref("If enabled, models and config are stored in and loaded from the database."),
	pendingActions = ref(new Set<string>());
const fallbackCandidates = computed(() =>
	modelOptions(props.modelGroups.filter((name) => name !== props.model?.model_name && !selected.value.includes(name))),
);
function addFallback(value: unknown) {
	if (typeof value === "string" && value && !selected.value.includes(value)) selected.value = [...selected.value, value];
}
function removeFallback(index: number) {
	selected.value = selected.value.filter((_, position) => position !== index);
}
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
		recurse.value = true;
		override.value = modelString(props.model?.model_info.override_model_name);
		const request = ++settingsRequest;
		loadingSettings.value = props.mode === "settings";
		// 递归开关只存在于 router_settings 里，model_info 的 fallback 链不带它；编辑前读一次原始条目。
		loadingFallbacks.value = props.mode === "fallback";
		if (props.mode === "fallback" && props.model?.model_name)
			try {
				const current = await modelsApi.fetchCallbacks();
				if (request !== settingsRequest) return;
				const entry = modelFallbackEntry(current.router_settings, props.model.model_name);
				if (entry) {
					selected.value = [...entry.targets];
					recurse.value = entry.recurse;
				}
			} catch (error) {
				if (request === settingsRequest)
					notification.error(error instanceof Error ? error.message : "Failed to load fallback settings");
			} finally {
				if (request === settingsRequest) loadingFallbacks.value = false;
			}
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
		nextRecurse = recurse.value,
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
				router_settings: updateModelFallbacks(current.router_settings, modelName, fallbacks, nextRecurse),
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
				<div class="model-routing-action__model">
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
				<template v-if="mode === 'override'">
					<span class="model-routing-action__secondary">Override Target</span>
					<UiSelect
						v-model="override"
						:options="modelOptions(modelGroups.filter((name) => name !== model?.model_name))"
						searchable
						clearable
						aria-label="Override Target"
						placeholder="No override"
					/>
					<span class="model-routing-action__secondary">
						All requests for this model are forced to the target before the first attempt, then fall back along the chain
						configured on the target. Clear the selection to restore normal routing.
					</span>
				</template>
				<UiSectionCard
					v-else-if="mode === 'fallback'"
					title="Fallback models"
					description="Tried top to bottom after this model fails. Drag a row, or use ↑/↓ on its handle, to change that order. Leave empty to remove the entry."
				>
					<UiSelect
						:model-value="null"
						:options="fallbackCandidates"
						searchable
						:disabled="loadingFallbacks || !fallbackCandidates.length"
						:placeholder="fallbackCandidates.length ? 'Add a fallback model' : 'No more models to add'"
						aria-label="Add fallback model"
						@update:model-value="addFallback"
					/>
					<UiSortableList
						:items="selected"
						:item-key="(name) => name"
						:label="(index, total) => 'fallback ' + (index + 1) + ' of ' + total"
						:disabled="loadingFallbacks"
						@update:items="selected = $event"
					>
						<template #item="{ item: name, index, itemProps, itemClass, handleProps }">
							<UiEntryCard :index="index + 1" :class="itemClass" v-bind="itemProps">
								<template #handle><UiDragHandle v-bind="handleProps" /></template>
								<template #title><ModelName :model="name" :size="16" variant="strong" /></template>
								<template #actions>
									<UiEntryRemove :label="'Remove fallback ' + name" @click="removeFallback(index)" />
								</template>
							</UiEntryCard>
						</template>
					</UiSortableList>
					<p v-if="!selected.length" class="model-routing-action__hint">No fallback models yet — add one above.</p>
					<template #footer>
						<UiSwitchRow
							v-model="recurse"
							:disabled="loadingFallbacks"
							label="Recursive fallback"
							description="Off keeps these models the final answer: if one of them fails, the proxy stops instead of using that model's own fallbacks."
						/>
					</template>
				</UiSectionCard>
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
.model-routing-action__model {
	display: flex;
	flex-direction: column;
	gap: 4px;
}
.model-routing-action__hint {
	margin: 0;
	font-size: 12px;
	line-height: 16px;
	color: #9ca3af;
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
