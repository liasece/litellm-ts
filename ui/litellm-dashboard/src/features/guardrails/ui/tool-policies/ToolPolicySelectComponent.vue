<script setup lang="ts">
import { computed } from "vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import { inputPolicyOptions, outputPolicyOptions, toolPolicyStyle } from "../../data/ToolPolicyOptions";
const props = withDefaults(
		defineProps<{
			value: string;
			toolName: string;
			saving: boolean;
			policyType?: "input" | "output";
			size?: "small" | "middle";
			minWidth?: number;
			stopPropagation?: boolean;
		}>(),
		{ policyType: "input", size: "small", minWidth: 110, stopPropagation: true },
	),
	emit = defineEmits<{ change: [toolName: string, policy: string] }>(),
	options = computed(() => (props.policyType === "output" ? outputPolicyOptions : inputPolicyOptions)),
	style = computed(() => toolPolicyStyle(props.value));
function select(value: unknown) {
	if (typeof value === "string") emit("change", props.toolName, value);
}
function click(event: MouseEvent) {
	if (props.stopPropagation) event.stopPropagation();
}
</script>
<template>
	<div
		class="tool-policy-select"
		:style="{
			minWidth: minWidth + 'px',
			fontWeight: 500,
			backgroundColor: style.background,
			borderColor: style.border,
			color: style.color,
			borderRadius: '999px',
			fontSize: size === 'small' ? '11px' : '12px',
		}"
		@click="click"
	>
		<UiSelect
			:model-value="value"
			:disabled="saving"
			:loading="saving"
			:size="size"
			:options="options.map((option) => ({ value: option.value, label: option.label }))"
			@update:model-value="select"
			><template #value="{ option }"
				><span class="tool-policy-choice" :style="{ color: toolPolicyStyle(String(option.value)).color }"
					><i :style="{ backgroundColor: toolPolicyStyle(String(option.value)).color }" />{{ option.label }}</span
				></template
			><template #option="{ option }"
				><span class="tool-policy-choice" :style="{ color: toolPolicyStyle(String(option.value)).color }"
					><i :style="{ backgroundColor: toolPolicyStyle(String(option.value)).color }" />{{ option.label }}</span
				></template
			></UiSelect
		>
	</div>
</template>
