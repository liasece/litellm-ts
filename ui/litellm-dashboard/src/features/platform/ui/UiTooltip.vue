<script setup lang="ts">
import UiPopover from "./UiPopover.vue";
withDefaults(
	defineProps<{
		title?: string;
		placement?: "top" | "bottom" | "bottomLeft" | "topLeft" | "left" | "right";
		/** 追加到气泡容器上的类名，供调用方覆盖共用样式（例如改为不透明底色）。 */
		popupClass?: string;
	}>(),
	{ title: undefined, placement: "top", popupClass: undefined },
);
</script>

<template>
	<UiPopover :content="title" :placement="placement" :popup-class="popupClass" dark
		><slot /><template v-if="$slots.content" #content><slot name="content" /></template
	></UiPopover>
</template>
