<script setup lang="ts">
import { computed, onBeforeUnmount, watch, type CSSProperties } from "vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { createModelSelectionStore } from "../stores/ModelSelectionStore";
import "../styles/ModelSelectorStyles.css";
defineOptions({ inheritAttrs: false });
const props = withDefaults(
	defineProps<{
		modelValue?: string;
		value?: string;
		accessToken?: string;
		placeholder?: string;
		disabled?: boolean;
		style?: CSSProperties;
		className?: string;
		showLabel?: boolean;
		labelText?: string;
	}>(),
	{
		modelValue: undefined,
		value: undefined,
		accessToken: undefined,
		placeholder: "Select a Model",
		disabled: false,
		style: undefined,
		className: undefined,
		showLabel: true,
		labelText: "Select Model",
	},
);
const emit = defineEmits<{ "update:modelValue": [value: string]; change: [value: string] }>();
const auth = useAuthenticationStore(),
	external = computed(() => props.modelValue ?? props.value),
	authorized = computed(() => (props.accessToken === undefined ? auth.isAuthorized.value : Boolean(props.accessToken))),
	store = createModelSelectionStore(external.value, (value) => {
		emit("update:modelValue", value);
		emit("change", value);
	});
watch(external, (value) => store.setValue(value));
watch(
	authorized,
	(value) => {
		if (value) void store.load();
	},
	{ immediate: true },
);
onBeforeUnmount(store.dispose);
function choose(value: unknown) {
	if (typeof value === "string") store.choose(value);
}
function custom(value: string | number | null) {
	store.typeCustom(String(value ?? ""));
}
</script>
<template>
	<div v-bind="$attrs" class="model-selection">
		<label v-if="showLabel"><UiIcon name="RobotOutlined" />{{ labelText }}</label
		><UiSelect
			:model-value="store.selected.value"
			:options="store.options.value"
			:placeholder="placeholder"
			:disabled="disabled"
			:style="{ width: '100%', ...style }"
			:class="['model-selection-select', className]"
			searchable
			@update:model-value="choose"
		/><UiInput
			v-if="store.custom.value"
			:model-value="store.customText.value"
			appearance="tremor"
			placeholder="Enter custom model name"
			:disabled="disabled"
			@update:model-value="custom"
		/>
	</div>
</template>
