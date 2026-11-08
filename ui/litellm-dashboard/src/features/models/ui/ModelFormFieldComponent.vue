<script setup lang="ts">
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
withDefaults(
	defineProps<{
		label: string;
		id?: string;
		required?: boolean;
		help?: string;
		tooltip?: string;
		tooltipIcon?: string;
		tooltipHref?: string;
		error?: string;
		vertical?: boolean;
	}>(),
	{ id: undefined, help: undefined, tooltip: undefined, tooltipIcon: "QuestionCircleOutlined", tooltipHref: undefined, error: undefined },
);
</script>
<template>
	<div class="model-field" :class="{ 'model-field--vertical': vertical, 'model-field--error': error }">
		<label v-if="label" :for="id" class="model-field__label"
			><span v-if="required" class="model-required">*</span>{{ label
			}}<span v-if="tooltipHref" class="model-field-tooltip-space">{{ " " }}</span
			><UiTooltip v-if="tooltip" :title="tooltip"
				><a
					v-if="tooltipHref"
					:href="tooltipHref"
					target="_blank"
					rel="noopener noreferrer"
					class="model-field-tooltip-link"
					@click.stop
					><UiIcon :name="tooltipIcon" /></a
				><UiIcon v-else :name="tooltipIcon" /></UiTooltip
			><span class="model-field__colon">:</span></label
		>
		<div class="model-field__control">
			<slot />
			<p v-if="error" role="alert" class="model-field__error">{{ error }}</p>
			<p v-else-if="help" class="model-field__help">{{ help }}</p>
		</div>
	</div>
</template>

<style scoped>
.model-field-tooltip-space {
	white-space: pre;
}
.model-field-tooltip-link {
	display: inline-flex;
	color: inherit;
}
.model-field__label .model-field-tooltip-link .ui-icon {
	color: inherit;
}
</style>
