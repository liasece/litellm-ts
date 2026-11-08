<script setup lang="ts">
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiTag from "../../platform/ui/UiTag.vue";
defineProps<{ title: string; description: string; modelValue: boolean; danger?: boolean }>();
defineEmits<{ "update:modelValue": [value: boolean] }>();
</script>
<template>
	<div class="cp-setting-toggle" :class="{ 'cp-setting-toggle--danger': danger }">
		<div>
			<div class="cp-inline cp-gap-8 cp-mb-4">
				<strong>{{ title }}</strong
				><UiTag v-if="danger" color="warning">Troubleshooting only</UiTag>
			</div>
			<p class="cp-secondary">{{ description }}</p>
		</div>
		<UiSwitch :model-value="modelValue" :label="title" @update:model-value="$emit('update:modelValue', $event)" />
	</div>
</template>
