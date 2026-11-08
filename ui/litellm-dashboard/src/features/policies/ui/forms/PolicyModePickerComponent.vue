<script setup lang="ts">
import UiTag from "../../../platform/ui/UiTag.vue";
defineProps<{ modelValue: string }>();
defineEmits<{ "update:modelValue": [value: string] }>();
</script>
<template>
	<div class="policy-mode-picker">
		<button type="button" :class="{ 'is-selected': modelValue === 'simple' }" @click="$emit('update:modelValue', 'simple')">
			<span class="policy-mode-icon"
				><svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					:stroke="modelValue === 'simple' ? '#4f46e5' : '#6b7280'"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<rect x="3" y="3" width="18" height="18" rx="2" />
					<path d="M8 7h8M8 12h8M8 17h5" /></svg></span
			><strong>Simple Mode</strong><span>Pick guardrails from a list. All run in parallel.</span>
		</button>
		<button type="button" :class="{ 'is-selected': modelValue === 'flow_builder' }" @click="$emit('update:modelValue', 'flow_builder')">
			<UiTag color="purple">NEW</UiTag
			><span class="policy-mode-icon"
				><svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					:stroke="modelValue === 'flow_builder' ? '#4f46e5' : '#6b7280'"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg></span
			><strong>Flow Builder</strong><span>Define steps, conditions, and error responses.</span>
		</button>
	</div>
</template>
