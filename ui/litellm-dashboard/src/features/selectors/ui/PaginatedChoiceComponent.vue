<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import { createPaginatedChoiceStore } from "../stores/PaginatedChoiceStore";
import type { ChoiceKind } from "../api/PaginatedChoiceApi";
const props = withDefaults(
	defineProps<{
		modelValue?: string | null;
		kind: ChoiceKind;
		placeholder?: string;
		pageSize?: number;
		disabled?: boolean;
		clearable?: boolean;
	}>(),
	{ modelValue: null, placeholder: undefined, pageSize: 50, clearable: true },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const store = createPaginatedChoiceStore(props.kind, props.pageSize);
function modelName(value: string | number) {
	return store.state.options.find((option) => option.value === value)?.modelName;
}
onMounted(() => void store.load());
onBeforeUnmount(store.dispose);
</script>
<template>
	<UiSelect
		:model-value="modelValue"
		:options="store.state.options"
		searchable
		:filterable="false"
		:clearable="clearable"
		:loading="store.state.loading"
		:placeholder="placeholder || (kind === 'model' ? 'Select a model' : 'Select a key alias')"
		:disabled="disabled"
		:empty-text="kind === 'model' ? 'No models found' : 'No key aliases found'"
		@search="store.search"
		@popup-scroll="store.scroll"
		@update:model-value="emit('update:modelValue', typeof $event === 'string' ? $event : '')"
	>
		<template #option="{ option }"
			><div v-if="kind === 'model'" class="paginated-model-option">
				<div v-if="modelName(option.value)"><strong>Model name:</strong> {{ modelName(option.value) }}</div>
				<span>Model ID: {{ option.value }}</span>
			</div>
			<span v-else>{{ option.label }}</span></template
		>
		<template #footer
			><div v-if="store.state.loadingMore" style="text-align: center; padding: 8px"><UiSpinner :size="14" /></div
		></template>
	</UiSelect>
</template>
<style>
.paginated-model-option {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.paginated-model-option > span {
	color: #00000073;
}
.paginated-model-option strong {
	font-weight: 600;
}
</style>
