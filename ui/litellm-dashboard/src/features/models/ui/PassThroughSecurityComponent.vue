<script setup lang="ts">
import UiCard from "../../platform/ui/UiCard.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
defineProps<{ premium: boolean; modelValue?: boolean }>();
defineEmits<{ "update:modelValue": [value: boolean] }>();
</script>
<template>
	<UiCard :padding="24" class="model-pass-security"
		><h3>Security</h3>
		<p>When enabled, requests to this endpoint will require a valid LiteLLM Virtual Key</p>
		<UiSwitch
			v-if="premium"
			:model-value="modelValue"
			aria-label="Require authentication"
			@update:model-value="$emit('update:modelValue', $event)"
		/><template v-else
			><div class="model-pass-premium-toggle"><UiSwitch disabled :model-value="false" /><span>Authentication (Premium)</span></div>
			<div class="model-pass-premium-notice">
				Setting authentication for pass-through endpoints is a LiteLLM Enterprise feature. Get a trial key
				<a href="https://www.litellm.ai/#pricing" target="_blank" rel="noreferrer">here</a>.
			</div></template
		></UiCard
	>
</template>
