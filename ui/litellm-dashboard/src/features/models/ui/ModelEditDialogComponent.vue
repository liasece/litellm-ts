<script setup lang="ts">
import { ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import ModelSettingsGrid from "./ModelSettingsGridComponent.vue";
import { createModelEditDraft, prepareModelUpdate, mergeModelUpdate } from "../logic/ModelEditLogic";
import { modelsApi } from "../api/ModelsApi";
import { normalizeModelDetails } from "../logic/ModelDataLogic";
import type { DisplayProxyModel, ModelCatalog } from "../support/ModelModels";
import notification from "../../notifications/logic/NotificationManager";
const open = defineModel<boolean>("open", { default: false });
const props = defineProps<{ model: DisplayProxyModel; catalog: ModelCatalog; modelNames: string[] }>();
const emit = defineEmits<{ updated: [model: DisplayProxyModel] }>();
const draft = ref(createModelEditDraft(props.model)),
	pending = ref(false);
watch(
	open,
	(value) => {
		if (value) draft.value = createModelEditDraft(props.model);
	},
	{ immediate: true },
);
async function save() {
	pending.value = true;
	try {
		const request = prepareModelUpdate(draft.value, props.model);
		if (!props.model.model_info.id) return;
		const response = await modelsApi.patchModel(props.model.model_info.id, { ...request });
		const updated = normalizeModelDetails(mergeModelUpdate(props.model, response, request));
		emit("updated", updated);
		notification.success("Model settings updated successfully");
		open.value = false;
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to update model settings";
		if (message === "Enter a new API key before switching to Manual credentials") notification.error(message);
		else notification.fromBackend(message);
	} finally {
		pending.value = false;
	}
}
</script>
<template>
	<UiDialog
		v-model:open="open"
		title="Edit Model Settings"
		width="min(960px, calc(100vw - 32px))"
		scroll-mode="overlay"
		:show-footer="false"
		class="model-edit-dialog"
		><form @submit.prevent="save">
			<ModelSettingsGrid v-model="draft" :model="model" :catalog="catalog" :model-names="modelNames" editing />
			<div class="model-edit-footer">
				<UiButton appearance="tremor" :disabled="pending" @click="open = false">Cancel</UiButton
				><UiButton appearance="tremor" variant="primary" :loading="pending" @click="save">Save Changes</UiButton>
			</div>
		</form></UiDialog
	>
</template>
