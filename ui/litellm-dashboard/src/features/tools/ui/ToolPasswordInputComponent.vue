<script setup lang="ts">
import { ref } from "vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
defineProps<{ modelValue?: string | number | null; placeholder?: string; id?: string; size?: "small" | "middle" | "large" }>();
defineEmits<{ "update:modelValue": [value: string | number | null] }>();
const visible = ref(false);
</script>
<template>
	<div class="tools-password-input">
		<UiInput
			:id="id"
			:model-value="modelValue"
			:type="visible ? 'text' : 'password'"
			:placeholder="placeholder"
			:size="size ?? 'middle'"
			@update:model-value="$emit('update:modelValue', $event)"
		/><button type="button" :aria-label="visible ? 'Hide password' : 'Show password'" @click="visible = !visible">
			<UiIcon :name="visible ? 'EyeOutlined' : 'EyeInvisibleOutlined'" />
		</button>
	</div>
</template>
