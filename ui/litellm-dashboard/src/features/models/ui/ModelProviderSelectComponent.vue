<script setup lang="ts">
import { computed } from "vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import { getProviderLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
import { providerSelectOptions } from "../logic/ModelProviderLogic";
import type { UiValue } from "../../platform/ui/UiTypes";
import type { ModelCatalog } from "../support/ModelModels";
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
const options = computed(() => providerSelectOptions(props.catalog.providerFields, props.valueField, props.modelValue ?? null));
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
