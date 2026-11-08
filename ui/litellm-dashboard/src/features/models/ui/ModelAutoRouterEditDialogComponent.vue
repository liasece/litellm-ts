<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import ModelField from "./ModelFormFieldComponent.vue";
import ModelSemanticRoutes from "./ModelSemanticRoutesComponent.vue";
import { routesFromConfig, type SemanticRoute } from "../logic/AutoRouterLogic";
import { modelsApi } from "../api/ModelsApi";
import { transformModels } from "../logic/ModelDataLogic";
import { modelString, modelStrings, modelOptions, type DisplayProxyModel, type ModelCatalog } from "../support/ModelModels";
import notification from "../../notifications/logic/NotificationManager";
const open = defineModel<boolean>("open", { default: false });
const props = defineProps<{ model: DisplayProxyModel; catalog: ModelCatalog; admin: boolean }>();
const emit = defineEmits<{ updated: [model: DisplayProxyModel] }>();
const name = ref(""),
	defaultModel = ref(""),
	embedding = ref(""),
	groups = ref<string[]>([]),
	routes = ref<SemanticRoute[]>([]),
	pending = ref(false),
	errors = ref<Record<string, string>>({});
const models = computed(() =>
	props.catalog.hub
		.map((model) => modelString(model.model_group))
		.filter(Boolean)
		.sort(),
);
watch(
	open,
	(value) => {
		if (!value) return;
		name.value = props.model.model_name;
		defaultModel.value = modelString(props.model.litellm_params.auto_router_default_model);
		embedding.value = modelString(props.model.litellm_params.auto_router_embedding_model);
		groups.value = modelStrings(props.model.model_info.access_groups);
		try {
			const config = props.model.litellm_params.auto_router_config;
			routes.value = routesFromConfig(typeof config === "string" ? JSON.parse(config) : config);
		} catch {
			routes.value = [];
			notification.fromBackend("Error loading auto router configuration");
		}
		errors.value = {};
	},
	{ immediate: true },
);
async function save() {
	errors.value = {};
	if (!name.value) errors.value.name = "Auto router name is required";
	if (!defaultModel.value) errors.value.default = "Default model is required";
	if (Object.keys(errors.value).length) return;
	pending.value = true;
	try {
		const params = {
				...props.model.litellm_params,
				auto_router_config: JSON.stringify({
					routes: routes.value.map(({ name, description, utterances, score_threshold }) => ({
						name,
						utterances,
						description,
						score_threshold,
					})),
				}),
				auto_router_default_model: defaultModel.value,
				auto_router_embedding_model: embedding.value || undefined,
			},
			info = { ...props.model.model_info, access_groups: groups.value };
		if (!props.model.model_info.id) return;
		await modelsApi.patchModel(props.model.model_info.id, { model_name: name.value, litellm_params: params, model_info: info });
		emit(
			"updated",
			transformModels([{ ...props.model, model_name: name.value, litellm_params: params, model_info: info }], props.catalog.costs)[0],
		);
		notification.success("Auto router configuration updated successfully");
		open.value = false;
	} catch {
		notification.fromBackend("Failed to update auto router configuration");
	} finally {
		pending.value = false;
	}
}
</script>
<template>
	<UiDialog
		v-model:open="open"
		title="Edit Auto Router Configuration"
		:width="1000"
		scroll-mode="overlay"
		ok-text="Save Changes"
		:confirm-loading="pending"
		@ok="save"
		><div class="model-auto-router-edit">
			<p class="model-text">Edit the auto router configuration including routing logic, default models, and access settings.</p>
			<ModelField label="Auto Router Name" vertical required :error="errors.name"
				><UiInput v-model="name" appearance="tremor" placeholder="e.g., auto_router_1, smart_routing" /></ModelField
			><ModelSemanticRoutes v-model="routes" :models="models" :catalog="catalog" /><ModelField
				label="Default Model"
				vertical
				required
				:error="errors.default"
				><UiSelect
					v-model="defaultModel"
					:options="[...modelOptions(models), { value: 'custom', label: 'Enter custom model name' }]"
					searchable
					placeholder="Select a default model" /></ModelField
			><ModelField label="Embedding Model" vertical
				><UiSelect
					v-model="embedding"
					:options="[...modelOptions(models), { value: 'custom', label: 'Enter custom model name' }]"
					searchable
					clearable
					placeholder="Select an embedding model (optional)" /></ModelField
			><ModelField v-if="admin" label="Model Access Groups" vertical tooltip="Control who can access this auto router"
				><UiSelect
					v-model="groups"
					max-tag-count="responsive"
					:options="modelOptions(catalog.accessGroups)"
					multiple
					searchable
					creatable
					clearable
					:token-separators="[',']"
					placeholder="Select existing groups or type to create new ones"
			/></ModelField></div
	></UiDialog>
</template>
