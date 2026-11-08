<script setup lang="ts">
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
defineProps<{ label: string; fullWidth?: boolean; tooltip?: string }>();
</script>
<template>
	<div class="model-setting-cell" :class="{ 'model-setting-cell--full': fullWidth }">
		<p>
			{{ label }}<UiTooltip v-if="tooltip" :title="tooltip"><UiIcon name="InfoCircleOutlined" /></UiTooltip>
		</p>
		<div><slot /></div>
	</div>
</template>
