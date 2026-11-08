<script setup lang="ts">
import { computed } from "vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import { getProviderLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
import type { UiSelectOption, UiValue } from "../../platform/ui/UiTypes";
import type { ModelCatalog, ProviderMetadata } from "../support/ModelModels";
const props = withDefaults(
	defineProps<{
		modelValue?: string | null;
		catalog: ModelCatalog;
		valueField?: "provider" | "litellm_provider";
		id?: string;
		disabled?: boolean;
		clearable?: boolean;
	}>(),
	{ modelValue: null, valueField: "provider", id: undefined },
);
defineEmits<{ "update:modelValue": [value: UiValue | UiValue[] | null] }>();
const options = computed<UiSelectOption[]>(() => {
	const unique = new Map<string, ProviderMetadata>();
	for (const provider of props.catalog.providerFields) {
		const key = provider[props.valueField];
		if (key && !unique.has(key)) unique.set(key, provider);
	}
	const popular = ["Anthropic", "OpenAI"].flatMap((key) => [...unique.values()].filter((provider) => provider.provider === key));
	const popularValues = new Set(popular.map((provider) => provider[props.valueField]));
	const others = [...unique.values()]
		.filter((provider) => !popularValues.has(provider[props.valueField]))
		.sort((a, b) => a.provider_display_name.localeCompare(b.provider_display_name));
	const output = [
		...popular.map((provider) => ({
			value: provider[props.valueField] || provider.provider,
			label: provider.provider_display_name,
			group: "Popular",
		})),
		...others.map((provider) => ({
			value: provider[props.valueField] || provider.provider,
			label: provider.provider_display_name,
			group: "All Providers",
		})),
	];
	if (props.modelValue && !unique.has(props.modelValue))
		output.push({ value: props.modelValue, label: props.modelValue, group: "All Providers" });
	if (!output.length && props.catalog.providerError) return [{ value: "", label: props.catalog.providerError, disabled: true }];
	return output;
});
function logo(value: UiValue) {
	const metadata = props.catalog.providerFields.find((provider) => provider[props.valueField] === value);
	return getProviderLogoAndName(metadata?.litellm_provider || String(value)).logo;
}
</script>
<template>
	<UiSelect
		:id="id"
		:model-value="modelValue"
		:options="options"
		searchable
		placeholder="Select a provider"
		:disabled="disabled"
		:clearable="clearable"
		@update:model-value="$emit('update:modelValue', $event)"
		><template #value="{ option }"
			><span class="model-provider-option"
				><img v-if="logo(option.value)" :src="logo(option.value)" alt="" class="model-provider-logo" />{{ option.label }}</span
			></template
		><template #option="{ option }"
			><span class="model-provider-option"
				><img v-if="logo(option.value)" :src="logo(option.value)" alt="" class="model-provider-logo" />{{ option.label }}</span
			></template
		></UiSelect
	>
</template>

<style scoped>
.model-provider-option {
	display: flex;
	align-items: center;
	gap: 8px;
}
</style>
