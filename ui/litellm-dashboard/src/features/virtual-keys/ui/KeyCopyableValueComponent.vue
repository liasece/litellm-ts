<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
const props = defineProps<{ value: string; label: string; copied: boolean }>();
const emit = defineEmits<{ copy: [] }>();
const element = ref<HTMLElement>();
const text = ref(props.value);
let observer: ResizeObserver | undefined;
function measure() {
	const root = element.value;
	const strong = root?.querySelector("strong");
	const button = root?.querySelector("button");
	if (!root || !strong || !button) return;
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (!context) return;
	const style = getComputedStyle(strong);
	context.font = style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
	// The value keeps the 160px ellipsis cap from the reference. Its flex column may be
	// narrower; the reference lets the text overflow the column instead of truncating at it.
	const available = Math.min(parseFloat(style.maxWidth) || 160, 160) - button.getBoundingClientRect().width - 4;
	if (context.measureText(props.value).width <= available) {
		text.value = props.value;
		return;
	}
	let low = 0,
		high = props.value.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (context.measureText(props.value.slice(0, mid) + "...").width <= available) low = mid;
		else high = mid - 1;
	}
	text.value = props.value.slice(0, low) + "...";
}
watch(
	() => props.value,
	() => {
		text.value = props.value;
		measure();
	},
	{ flush: "post" },
);
onMounted(() => {
	observer = new ResizeObserver(measure);
	if (element.value) observer.observe(element.value);
	measure();
});
onBeforeUnmount(() => observer?.disconnect());
</script>
<template>
	<span ref="element" class="vk-key-fact-value-text vk-key-fact-truncate" :aria-label="value"
		><strong
			>{{ text
			}}<button type="button" :aria-label="'Copy ' + label" :title="copied ? 'Copied!' : 'Copy ' + label" @click="emit('copy')">
				<UiIcon :name="copied ? 'CheckOutlined' : 'CopyOutlined'" /></button></strong
	></span>
</template>
