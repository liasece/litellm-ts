<script setup lang="ts">
import { computed } from "vue";
import UiTag from "../../../platform/ui/UiTag.vue";
const props = withDefaults(defineProps<{ color?: string; size?: "xs" | "sm" | "default"; antd?: boolean }>(), {
	color: "blue",
	size: "default",
});
const antdColors: Readonly<Record<string, string>> = { emerald: "green", yellow: "gold" };
const color = computed(() => (props.antd ? (antdColors[props.color] ?? props.color) : props.color));
</script>
<template>
	<UiTag
		:color="color"
		:appearance="antd ? 'antd' : 'tremor'"
		:size="size === 'xs' ? 'xs' : 'sm'"
		class="hub-badge"
		:class="['hub-badge--' + size, 'hub-badge--' + color]"
		><slot
	/></UiTag>
</template>
<style>
/* The original private provider, skill and tool Tags explicitly used text-xs. */
.hub-badge.ui-tag--antd.hub-text-xs {
	font-size: 12px;
	line-height: 16px;
}
</style>
