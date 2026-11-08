<script setup lang="ts">
import UiPopover from "./UiPopover.vue";
withDefaults(defineProps<{ title?: string; placement?: "top" | "bottom" | "bottomLeft" | "topLeft" | "left" | "right" }>(), {
	title: undefined,
	placement: "top",
});
</script>

<template>
	<UiPopover :content="title" :placement="placement" dark
		><slot /><template v-if="$slots.content" #content><slot name="content" /></template
	></UiPopover>
</template>
