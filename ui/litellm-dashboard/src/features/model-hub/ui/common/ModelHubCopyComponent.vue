<script setup lang="ts">
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
import { copyHubText } from "../../logic/ModelHubClipboardLogic";
withDefaults(defineProps<{ value: string; title?: string; size?: number; lucide?: boolean; boxed?: boolean; tooltip?: boolean }>(), {
	title: "Copy",
	size: 12,
	tooltip: true,
});
</script>
<template>
	<component :is="tooltip ? UiTooltip : 'span'" :title="tooltip ? title : undefined">
		<button
			type="button"
			class="hub-copy"
			:class="{ 'hub-copy--boxed': boxed }"
			:aria-label="title"
			:style="{ fontSize: size + 'px' }"
			@click.stop="copyHubText(value)"
		>
			<UiLucideIcon v-if="lucide" name="Copy" :size="size" /><UiIcon v-else name="CopyOutlined" />
		</button>
	</component>
</template>
<style>
.hub-copy {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	background: none;
	border: 0;
	padding: 0;
	color: #6b7280;
	cursor: pointer;
	flex-shrink: 0;
	line-height: 1;
}
.hub-copy:hover {
	color: #3b82f6;
}
.hub-copy--boxed {
	width: 38px;
	height: 30px;
	border: 1px solid #6366f1;
	border-radius: 8px;
	padding: 6px 10px;
	background: transparent;
	color: #6366f1;
	box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
}
.hub-copy--boxed:hover {
	background: #eef2ff;
	color: #4f46e5;
}
</style>
