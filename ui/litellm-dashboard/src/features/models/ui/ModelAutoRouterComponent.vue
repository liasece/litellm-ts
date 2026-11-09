<script setup lang="ts">
import { computed, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import ModelField from "./ModelFormFieldComponent.vue";
import ModelComplexityTiers from "./ModelComplexityTiersComponent.vue";
import ModelSemanticRoutes from "./ModelSemanticRoutesComponent.vue";
import { nextUiIdentity } from "../../platform/ui/UiIdentity";
import { createAutoRouter, type ComplexityTiers, type SemanticRoute } from "../logic/AutoRouterLogic";
import type { ModelCreateDraft } from "../logic/ModelCreateLogic";
import { modelString, modelStrings, modelOptions, type ModelCatalog } from "../support/ModelModels";
import { modelsApi } from "../api/ModelsApi";
import notification from "../../notifications/logic/NotificationManager";
const props = defineProps<{ catalog: ModelCatalog; admin: boolean }>();
const emit = defineEmits<{ created: [] }>();
const values = ref<ModelCreateDraft>({}),
	type = ref<"complexity" | "semantic">("complexity"),
	tiers = ref<ComplexityTiers>({ SIMPLE: "", MEDIUM: "", COMPLEX: "", REASONING: "" }),
	routes = ref<SemanticRoute[]>([]),
	pending = ref(false);
const prefix = nextUiIdentity("auto-router");
const models = computed(() => [...new Set(props.catalog.hub.map((model) => modelString(model.model_group)).filter(Boolean))].sort());
async function submit() {
	let request;
	try {
		request = createAutoRouter(values.value, type.value, tiers.value, routes.value);
	} catch (error) {
		notification.fromBackend(error instanceof Error ? error.message : String(error));
		return;
	}
	pending.value = true;
	try {
		await modelsApi.createModel(request);
		notification.success(
			"Successfully created " +
				(type.value === "complexity" ? "Complexity Router" : "Semantic Router") +
				": " +
				modelString(values.value.auto_router_name),
		);
		values.value = {};
		emit("created");
	} catch (error) {
		notification.fromBackend("Failed to add auto router: " + (error instanceof Error ? error.message : String(error)));
	} finally {
		pending.value = false;
	}
}
</script>
<template>
	<div class="model-auto-router">
		<h2 class="model-ant-title">Add Auto Router</h2>
		<p class="model-text model-auto-description">
			Create an auto router that automatically selects the best model based on request complexity or semantic matching.
		</p>
		<UiCard appearance="antd" class="model-router-type-card"
			><p>Router Type</p>
			<label class="model-router-choice"
				><input v-model="type" type="radio" value="complexity" name="router-type" /><span
					><span class="model-inline"
						><UiIcon name="ThunderboltOutlined" class="model-warning" /><strong>Complexity Router</strong
						><small>Recommended</small></span
					><span class="model-router-description"
						>Automatically routes based on request complexity. No training data needed — just pick 4 models and go.<br /><span
							class="model-success"
							>✓ Zero API calls</span
						>
						· <span class="model-success">✓ &lt;1ms latency</span> · <span class="model-success">✓ No cost</span></span
					></span
				></label
			><label class="model-router-choice"
				><input v-model="type" type="radio" value="semantic" name="router-type" /><span
					><span class="model-inline"><UiIcon name="BranchesOutlined" class="model-link" /><strong>Semantic Router</strong></span
					><span class="model-router-description"
						>Routes based on semantic similarity to example utterances. Requires embedding model and training examples.</span
					></span
				></label
			></UiCard
		><UiCard appearance="antd"
			><form @submit.prevent="submit">
				<ModelField
					label="Auto Router Name"
					:id="prefix + '-name'"
					required
					tooltip="Unique name for this auto router configuration"
					><UiInput
						:id="prefix + '-name'"
						:model-value="modelString(values.auto_router_name)"
						appearance="tremor"
						placeholder="e.g., smart_router, auto_router_1"
						@update:model-value="values.auto_router_name = $event" /></ModelField
				><ModelComplexityTiers v-if="type === 'complexity'" v-model="tiers" :models="models" /><template v-else
					><ModelSemanticRoutes v-model="routes" :models="models" :catalog="catalog" /><ModelField
						label="Default Model"
						:id="prefix + '-default'"
						required
						tooltip="Fallback model to use when auto routing logic cannot determine the best model"
						><UiSelect
							:id="prefix + '-default'"
							:model-value="modelString(values.auto_router_default_model) || null"
							:options="[...modelOptions(models), { value: 'custom', label: 'Enter custom model name' }]"
							searchable
							placeholder="Select a default model"
							@update:model-value="values.auto_router_default_model = $event" /></ModelField
					><ModelField
						label="Embedding Model"
						:id="prefix + '-embedding'"
						tooltip="Optional: Embedding model to use for semantic routing decisions"
						><UiSelect
							:id="prefix + '-embedding'"
							:model-value="modelString(values.auto_router_embedding_model) || null"
							:options="[...modelOptions(models), { value: 'custom', label: 'Enter custom model name' }]"
							searchable
							clearable
							placeholder="Select an embedding model (optional)"
							@update:model-value="values.auto_router_embedding_model = $event" /></ModelField
				></template>
				<div class="model-divider"><span>Additional Settings</span></div>
				<ModelField
					v-if="admin"
					label="Model Access Group"
					:id="prefix + '-access'"
					tooltip="Use model access groups to control who can access this auto router"
					><UiSelect
						:id="prefix + '-access'"
						:model-value="modelStrings(values.model_access_group)"
						max-tag-count="responsive"
						:options="modelOptions(catalog.accessGroups)"
						multiple
						searchable
						creatable
						:token-separators="[',']"
						clearable
						placeholder="Select existing groups or type to create new ones"
						@update:model-value="values.model_access_group = $event"
				/></ModelField>
				<div class="model-form-footer">
					<a href="https://github.com/BerriAI/litellm/issues" target="_blank" rel="noreferrer">Need Help?</a>
					<div>
						<UiButton variant="primary" :loading="pending" @click="submit">Add Auto Router</UiButton>
					</div>
				</div>
			</form></UiCard
		>
	</div>
</template>
