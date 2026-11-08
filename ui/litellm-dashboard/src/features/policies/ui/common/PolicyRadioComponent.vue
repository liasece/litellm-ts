<script setup lang="ts">
defineProps<{ modelValue: string; value: string; button?: boolean }>();
defineEmits<{ "update:modelValue": [value: string] }>();
</script>
<template>
	<label class="policy-radio" :class="{ 'policy-radio--button': button, 'is-checked': modelValue === value }"
		><input type="radio" :checked="modelValue === value" :value="value" @change="$emit('update:modelValue', value)" /><span
			><slot /></span
	></label>
</template>
