<script setup lang="ts">
import UiPopover from "../../../platform/ui/UiPopover.vue";
import ModelHubBadgeComponent from "./ModelHubBadgeComponent.vue";
withDefaults(defineProps<{ values: string[]; color?: "blue" | "purple"; label: string }>(), { color: "blue" });
</script>
<template>
	<span v-if="!values.length" class="hub-muted">-</span>
	<div v-else class="hub-overflow-tags">
		<ModelHubBadgeComponent :color="color" antd>{{ values[0] }}</ModelHubBadgeComponent
		><UiPopover v-if="values.length > 1" dark trigger="click" placement="topLeft"
			><button type="button" :class="'hub-overflow-tags__' + color">+{{ values.length - 1 }}</button
			><template #content
				><strong>All {{ label }}:</strong>
				<div v-for="value in values" :key="value" class="hub-overflow-tags__item">• {{ value }}</div></template
			></UiPopover
		>
	</div>
</template>
<style>
.hub-overflow-tags {
	display: flex;
	height: 24px;
	align-items: center;
	gap: 4px;
}
.hub-overflow-tags .ui-tag {
	font-size: 12px;
	line-height: 16px;
}
.hub-overflow-tags button {
	font-size: 12px;
	background: none;
	border: 0;
	padding: 0;
	cursor: pointer;
}
.hub-overflow-tags button:hover {
	text-decoration: underline;
}
.hub-overflow-tags__blue {
	color: #2563eb;
}
.hub-overflow-tags__purple {
	color: #9333ea;
}
.hub-overflow-tags__item {
	font-size: 12px;
	line-height: 16px;
	margin-top: 4px;
}
</style>
