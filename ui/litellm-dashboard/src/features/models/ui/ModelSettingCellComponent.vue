<script setup lang="ts">
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UpstreamModelHint from "./UpstreamModelHintComponent.vue";
import type { UpstreamModelInfoPayload } from "../support/UpstreamModelInfoModels";
defineProps<{
	label: string;
	fullWidth?: boolean;
	tooltip?: string;
	/** 提供后标签右侧出现上游信息图标（hover 展示上游抓到的值）。 */
	hintModel?: string;
	hintField?: string;
	hintRecord?: UpstreamModelInfoPayload | null;
}>();
</script>
<template>
	<div class="model-setting-cell" :class="{ 'model-setting-cell--full': fullWidth }">
		<p>
			{{ label }}<UiTooltip v-if="tooltip" :title="tooltip"><UiIcon name="InfoCircleOutlined" /></UiTooltip
			><UpstreamModelHint v-if="hintModel" :model="hintModel" :field="hintField" :record="hintRecord" :label="label" />
		</p>
		<div><slot /></div>
	</div>
</template>
