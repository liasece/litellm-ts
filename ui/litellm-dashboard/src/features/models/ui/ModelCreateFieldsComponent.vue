<script setup lang="ts">
import { computed, ref } from "vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiEmptyState from "../../platform/ui/UiEmptyState.vue";
import ModelMappingHelp from "./ModelMappingHelpComponent.vue";
import ModelField from "./ModelFormFieldComponent.vue";
import ModelProviderSelect from "./ModelProviderSelectComponent.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { providerModels, providerCatalogSlug, getPlaceholder } from "../logic/ModelProviderLogic";
import { selectedModelMappings, type ModelCreateDraft } from "../logic/ModelCreateLogic";
import { isSubscriptionProviderSlug } from "../../subscriptions/logic/SubscriptionProviderLogic";
import { modelString, modelStrings, modelOptions, type ModelCatalog } from "../support/ModelModels";
import { TEST_MODES } from "../data/ModelModesData";
import { modelsApi } from "../api/ModelsApi";
import notification from "../../notifications/logic/NotificationManager";
const values = defineModel<ModelCreateDraft>({ required: true });
const provider = defineModel<string>("provider", { required: true });
const props = defineProps<{ catalog: ModelCatalog; errors: Record<string, string>; prefix: string }>();
const available = ref<string[]>([]),
	loading = ref(false);
let generation = 0;
const selected = computed(() =>
	typeof values.value.model === "string" ? (values.value.model ? [values.value.model] : []) : (values.value.model ?? []),
);
const modelHelp = computed(() =>
	provider.value === "Azure"
		? "Your deployment name will be saved as the public model name, and LiteLLM will use 'azure/deployment-name' internally"
		: "The model name LiteLLM will send to the LLM API",
);
const resolvedSlug = computed(() => providerCatalogSlug(props.catalog.providerFields, provider.value));
const subscriptionSlug = computed(() => (isSubscriptionProviderSlug(resolvedSlug.value) ? resolvedSlug.value : ""));
const textMode = computed(() => ["Azure", "OpenAI_Compatible", "Ollama"].includes(provider.value) || !available.value.length);
async function changeProvider(value: unknown) {
	const next = modelString(value);
	provider.value = next;
	// Keep the catalog label here so the select keeps its selected option; the
	// publish step resolves it to the canonical slug through the same catalog.
	values.value = {
		...values.value,
		custom_llm_provider: next,
		litellm_credential_name: undefined,
		model: [],
		model_name: undefined,
	};
	const current = ++generation;
	loading.value = true;
	if (isSubscriptionProviderSlug(providerCatalogSlug(props.catalog.providerFields, next)))
		try {
			const models = await modelsApi.fetchSubscriptionModels(providerCatalogSlug(props.catalog.providerFields, next));
			if (current === generation) available.value = models;
		} catch (error) {
			if (current === generation) {
				available.value = [];
				notification.fromBackend("Failed to load subscription models: " + (error instanceof Error ? error.message : String(error)));
			}
		}
	else available.value = providerModels(next, props.catalog.costs);
	if (current === generation) loading.value = false;
}
function models(value: unknown) {
	const next = Array.isArray(value) ? modelStrings(value) : modelString(value);
	values.value = {
		...values.value,
		model: next,
		model_mappings: selectedModelMappings(next, resolvedSlug.value, modelString(values.value.custom_model_name)),
	};
	if ((typeof next === "string" ? [next] : next).includes("all-wildcard")) values.value.model_name = undefined;
}
function custom(value: unknown) {
	values.value = {
		...values.value,
		custom_model_name: modelString(value),
		model_mappings: selectedModelMappings(values.value.model, resolvedSlug.value, modelString(value)),
	};
}
function mapping(index: number, value: unknown) {
	const next = modelString(value);
	if (resolvedSlug.value === "anthropic" && next.endsWith("-1m") && !modelString(values.value.litellm_extra_params).trim()) {
		values.value.litellm_extra_params = JSON.stringify({ extra_headers: { "anthropic-beta": "context-1m-2025-08-07" } }, null, 2);
		values.value.model_mappings![index].public_name = next.slice(0, -3);
	} else values.value.model_mappings![index].public_name = next;
}
defineExpose({
	providerFields: computed(() => props.catalog.providerFields.find((item) => item.provider === provider.value)?.credential_fields ?? []),
});
</script>
<template>
	<ModelField
		label="Provider"
		:id="prefix + '-provider'"
		required
		tooltip="E.g. OpenAI, Azure OpenAI, Anthropic, Bedrock, etc."
		:error="errors.custom_llm_provider"
		><ModelProviderSelect
			:id="prefix + '-provider'"
			:model-value="values.custom_llm_provider"
			:catalog="catalog"
			@update:model-value="changeProvider"
	/></ModelField>
	<ModelField
		label="LiteLLM Model Name(s)"
		class="model-name-field"
		:id="prefix + '-models'"
		tooltip="The model name LiteLLM will send to the LLM API"
		:error="errors.model"
		><UiInput
			v-if="textMode"
			:id="prefix + '-models'"
			:model-value="typeof values.model === 'string' ? values.model : ''"
			appearance="tremor"
			:placeholder="getPlaceholder(provider)"
			@update:model-value="models"
		/><UiSelect
			v-else
			:id="prefix + '-models'"
			:model-value="modelStrings(values.model)"
			:options="[
				{ value: 'custom', label: 'Custom Model Name (Enter below)' },
				...(subscriptionSlug ? [] : [{ value: 'all-wildcard', label: 'All ' + provider + ' Models (Wildcard)' }]),
				...modelOptions(available),
			]"
			multiple
			searchable
			clearable
			:loading="loading"
			placeholder="Select models"
			@update:model-value="models"
		/><UiInput
			v-if="selected.includes('custom')"
			:model-value="modelString(values.custom_model_name)"
			appearance="tremor"
			:placeholder="provider === 'Azure' ? 'Enter Azure deployment name' : 'Enter custom model name'"
			class="model-custom-name"
			@update:model-value="custom"
		/>
		<p v-if="errors.custom_model_name" class="model-error">{{ errors.custom_model_name }}</p></ModelField
	>
	<p class="model-name-help">{{ modelHelp }}</p>
	<ModelField
		v-if="!selected.includes('all-wildcard')"
		label="Model Mappings"
		required
		tooltip="Map public model names to LiteLLM model names for load balancing"
		:error="errors.model_mappings"
		><div class="model-mapping-table">
			<table>
				<thead>
					<tr>
						<th>
							<span class="model-mapping-heading">
								Public Model Name
								<ModelMappingHelp kind="public"
							/></span>
						</th>
						<th>
							<span class="model-mapping-heading">
								LiteLLM Model Name
								<ModelMappingHelp kind="litellm"
							/></span>
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="(item, index) in values.model_mappings" :key="index">
						<td>
							<UiInput
								:model-value="item.public_name"
								:aria-label="'Public Model Name ' + (index + 1)"
								appearance="tremor"
								@update:model-value="mapping(index, $event)"
							/>
						</td>
						<td>
							<ModelName
								v-if="item.litellm_model"
								class="model-deployment-target"
								:model="item.litellm_model"
								:provider="provider"
								:size="14"
							/><span v-else>-</span>
						</td>
					</tr>
					<tr v-if="!values.model_mappings?.length">
						<td colspan="2"><UiEmptyState description="No data" /></td>
					</tr>
				</tbody>
			</table></div
	></ModelField>
	<ModelField label="Mode" :id="prefix + '-mode'" class="model-mode-field"
		><UiSelect
			:id="prefix + '-mode'"
			:model-value="modelString(values.mode) || null"
			:options="TEST_MODES"
			placeholder=""
			@update:model-value="values.mode = $event"
	/></ModelField>
	<div class="model-mode-help-row">
		<p class="model-mode-help">
			<strong>Optional</strong> - LiteLLM endpoint to use when health checking this model
			<a href="https://docs.litellm.ai/docs/proxy/health#health" target="_blank" rel="noreferrer">Learn more</a>
		</p>
	</div>
</template>
