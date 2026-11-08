<script setup lang="ts">
import { useKeyFieldIdentity } from "../support/KeyFormIdentity";
import UiFormField from "../../platform/ui/UiFormField.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
withDefaults(
	defineProps<{
		label?: string;
		name?: string;
		tooltip?: string;
		tooltipHref?: string;
		controlMinHeight?: number;
		tooltipIcon?: string;
		help?: string;
		error?: string;
		required?: boolean;
		horizontal?: boolean;
	}>(),
	{
		label: undefined,
		name: undefined,
		tooltip: undefined,
		tooltipHref: undefined,
		controlMinHeight: undefined,
		tooltipIcon: "InfoCircleOutlined",
		help: undefined,
		error: undefined,
	},
);
const fieldId = useKeyFieldIdentity();
</script>
<template>
	<UiFormField
		:label="label"
		:for="name ? fieldId(name) : undefined"
		:help="help"
		:error="error"
		:required="required"
		:horizontal="horizontal"
		class="vk-field"
		><template v-if="label" #label
			>{{ label
			}}<template v-if="tooltip"
				><template v-if="tooltipIcon === 'InfoCircleOutlined'">{{ " " }}</template
				><UiTooltip :title="tooltip"
					><a v-if="tooltipHref" :href="tooltipHref" target="_blank" rel="noopener noreferrer" @click.stop
						><UiIcon :name="tooltipIcon" :size="14" class="vk-field-info" /></a
					><UiIcon
						v-else
						:name="tooltipIcon"
						:size="14"
						class="vk-field-info"
						:class="{ 'vk-field-info--form': tooltipIcon === 'QuestionCircleOutlined' }" /></UiTooltip></template
		></template>
		<div v-if="controlMinHeight != null" class="vk-field-control-input" :style="{ minHeight: controlMinHeight + 'px' }"><slot /></div>
		<slot v-else
	/></UiFormField>
</template>
