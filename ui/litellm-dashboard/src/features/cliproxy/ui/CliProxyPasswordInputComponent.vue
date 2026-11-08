<script setup lang="ts">
import { ref } from "vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
defineProps<{ modelValue: string; placeholder?: string }>();
defineEmits<{ "update:modelValue": [value: string] }>();
const visible = ref(false);
</script>
<template>
	<UiInput
		:model-value="modelValue"
		:type="visible ? 'text' : 'password'"
		:placeholder="placeholder"
		@update:model-value="$emit('update:modelValue', String($event ?? ''))"
		><template #suffix
			><button
				type="button"
				class="cp-password-eye"
				:aria-label="visible ? 'Hide password' : 'Show password'"
				@click="visible = !visible"
			>
				<UiIcon :name="visible ? 'EyeOutlined' : 'EyeInvisibleOutlined'" :size="14" /></button></template
	></UiInput>
</template>
