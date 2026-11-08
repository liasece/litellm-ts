<script setup lang="ts">
defineProps<{ label?: string; for?: string; required?: boolean; error?: string; help?: string; horizontal?: boolean }>();
</script>

<template>
	<div class="ui-form-field" :class="{ 'ui-form-field--horizontal': horizontal, 'ui-form-field--error': error }">
		<label v-if="label || $slots.label" class="ui-form-field__label" :for="$props.for"
			><span v-if="required" class="ui-form-field__required" aria-hidden="true">*</span><slot name="label">{{ label }}</slot></label
		>
		<div class="ui-form-field__control">
			<slot />
			<p v-if="error" class="ui-form-field__error" role="alert">{{ error }}</p>
			<p v-else-if="help" class="ui-form-field__help">{{ help }}</p>
		</div>
	</div>
</template>
