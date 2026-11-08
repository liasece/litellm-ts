<script setup lang="ts">
import type { UiControlSize } from "../../../platform/ui/UiTypes";
import UiInput from "../../../platform/ui/UiInput.vue";
defineProps<{ modelValue: string; size?: UiControlSize; placeholder?: string }>();
const emit = defineEmits<{ "update:modelValue": [string] }>();
</script>
<template>
	<UiInput
		:model-value="modelValue"
		:size="size"
		type="password"
		:visibility-toggle="true"
		:placeholder="placeholder"
		@update:model-value="emit('update:modelValue', String($event ?? ''))"
	/>
</template>
