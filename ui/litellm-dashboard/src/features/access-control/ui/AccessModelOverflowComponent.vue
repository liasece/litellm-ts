<script setup lang="ts">
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import "../styles/ModelSelectionOverflowStyles.css";
defineProps<{ options: readonly { value: string | number }[]; count: number }>();
</script>
<template>
	<UiTooltip :title="options.map((option) => option.value).join(', ')" popup-class="access-model-overflow-tooltip"
		><span>+{{ count }} more</span></UiTooltip
	>
</template>
