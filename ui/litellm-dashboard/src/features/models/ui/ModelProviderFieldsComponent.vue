<script setup lang="ts">
import { computed, watch } from "vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import ModelField from "./ModelFormFieldComponent.vue";
import { Providers, provider_map } from "../../providers/data/ProviderCatalogData";
import { modelInput, modelString, modelOptions, type ModelCatalog } from "../support/ModelModels";
const values = defineModel<Record<string, unknown>>({ required: true });
const props = withDefaults(
	defineProps<{
		provider: string;
		catalog: ModelCatalog;
		idPrefix: string;
		errors?: Record<string, string>;
		vertical?: boolean;
		edit?: boolean;
		configured?: readonly string[];
	}>(),
	{ errors: () => ({}), configured: () => [] },
);
const emit = defineEmits<{ touched: [key: string] }>();
const fields = computed(() => {
	const name = Providers[props.provider as keyof typeof Providers] ?? props.provider,
		slug = provider_map[props.provider] ?? props.provider;
	return (
		props.catalog.providerFields.find((item) =>
			[item.provider, item.provider_display_name, item.litellm_provider].some(
				(value) => value === props.provider || value === name || value === slug,
			),
		)?.credential_fields ?? []
	);
});
function set(key: string, value: unknown) {
	values.value = { ...values.value, [key]: value };
	emit("touched", key);
}
function placeholder(field: (typeof fields.value)[number]) {
	return props.edit && props.configured.includes(field.key)
		? "Configured — leave blank to keep current value"
		: (field.placeholder ?? undefined);
}
async function upload(event: Event) {
	const file = (event.target as HTMLInputElement).files?.[0];
	if (file?.type === "application/json") set("vertex_credentials", await file.text());
}
watch(
	fields,
	() => {
		for (const field of fields.value)
			if (field.default_value != null && values.value[field.key] === undefined) set(field.key, field.default_value);
	},
	{ immediate: true },
);
defineExpose({ fields });
</script>
<template>
	<p v-if="catalog.providerError && !fields.length" class="model-error">{{ catalog.providerError }}</p>
	<ModelField
		v-for="field in fields"
		:key="field.key"
		:label="field.label"
		:id="idPrefix + '-' + field.key"
		:tooltip="field.tooltip ?? undefined"
		:required="field.required && !(edit && configured.includes(field.key))"
		:error="errors[field.key]"
		:vertical="vertical"
	>
		<UiSelect
			v-if="field.field_type === 'select'"
			:id="idPrefix + '-' + field.key"
			:model-value="modelString(values[field.key]) || null"
			:options="modelOptions(field.options ?? [])"
			:placeholder="placeholder(field)"
			@update:model-value="set(field.key, $event)"
		/>
		<label v-else-if="field.field_type === 'upload'" class="model-upload"
			><UiButton @click="($refs['upload-' + field.key] as HTMLInputElement[])?.[0]?.click()"
				><template #icon><UiIcon name="UploadOutlined" /></template>Click to Upload</UiButton
			><input :id="idPrefix + '-' + field.key" :ref="'upload-' + field.key" type="file" accept=".json" hidden @change="upload"
		/></label>
		<UiInput
			v-else
			:id="idPrefix + '-' + field.key"
			:model-value="modelInput(values[field.key])"
			:type="field.field_type === 'password' ? 'password' : 'text'"
			:multiline="field.field_type === 'textarea'"
			:rows="field.field_type === 'textarea' ? 6 : undefined"
			:appearance="field.field_type === 'textarea' ? 'antd' : 'tremor'"
			:placeholder="placeholder(field)"
			@update:model-value="set(field.key, $event)"
		/>
		<template v-if="field.key === 'vertex_credentials'"
			><p class="model-field__help">
				Give the json dict from your GCP Service Account .json file
				<a href="https://docs.litellm.ai/docs/providers/vertex#authentication" target="_blank" rel="noreferrer">Learn more</a>
			</p></template
		>
		<template v-if="field.key === 'base_model'"
			><p class="model-field__help">Base model name, used for model cost tracking.</p></template
		>
	</ModelField>
</template>
