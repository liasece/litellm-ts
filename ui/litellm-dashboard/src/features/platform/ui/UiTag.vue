<script setup lang="ts">
import { computed } from "vue";
import type { UiAppearance } from "./UiTypes";
const props = withDefaults(defineProps<{ color?: string; appearance?: UiAppearance; closable?: boolean; size?: "xs" | "sm" }>(), {
	color: "default",
	appearance: "antd",
	size: "sm",
});
defineEmits<{ close: [] }>();
const aliases: Readonly<Record<string, string>> = { success: "green", error: "red", processing: "blue", warning: "gold" };
const known = new Set([
	"default",
	"blue",
	"green",
	"red",
	"orange",
	"gold",
	"purple",
	"cyan",
	"indigo",
	"geekblue",
	"lime",
	"magenta",
	"volcano",
]);
const tremorColors = new Set([
	"slate",
	"gray",
	"zinc",
	"neutral",
	"stone",
	"red",
	"orange",
	"amber",
	"yellow",
	"lime",
	"green",
	"emerald",
	"teal",
	"cyan",
	"sky",
	"blue",
	"indigo",
	"violet",
	"purple",
	"fuchsia",
	"pink",
	"rose",
]);
const colorName = computed(() => aliases[props.color] || props.color);
const customStyle = computed(() =>
	known.has(colorName.value) || (props.appearance === "tremor" && tremorColors.has(colorName.value))
		? undefined
		: { color: "white", backgroundColor: props.color, borderColor: "transparent" },
);
</script>

<template>
	<span class="ui-tag" :class="['ui-tag--' + colorName, 'ui-tag--' + appearance, 'ui-tag--' + size]" :style="customStyle"
		><slot /><button v-if="closable" type="button" aria-label="Remove" class="ui-tag__close" @click="$emit('close')">×</button></span
	>
</template>
