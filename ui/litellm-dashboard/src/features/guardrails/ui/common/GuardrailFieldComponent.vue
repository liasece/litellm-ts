<script setup lang="ts">
import UiFormField from "../../../platform/ui/UiFormField.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
defineProps<{ label: string; required?: boolean; error?: string; tooltip?: string; help?: string }>();
</script>
<template>
	<UiFormField :required="required" :error="error" :help="help"
		><template #label
			>{{ label
			}}<UiTooltip v-if="tooltip" :title="tooltip"
				><UiIcon name="QuestionCircleOutlined" class="guardrail-label-help" /></UiTooltip></template
		><slot
	/></UiFormField>
</template>
