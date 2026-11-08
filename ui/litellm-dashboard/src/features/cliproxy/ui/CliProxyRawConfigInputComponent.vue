<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
const props = defineProps<{ modelValue: string; open: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const wrapper = ref<HTMLElement>();
const textarea = ref<HTMLTextAreaElement>();
const height = ref(704);
const minimum = ref(704);
const maximum = ref(1152);
const overflowing = ref(false);
let observer: ResizeObserver | undefined;
let probe: HTMLTextAreaElement | undefined;
let hasOpened = false;
let measuredWidth: number | null = null;
const legacyMeasurement = ref(true);
// Legacy Raw YAML initially retains outer min/max 714/1162px, including edits.
// Its real 22px row measurement takes over when input width changes or it reopens.
// Keep that observed compatibility locally rather than changing every shared input.
const LEGACY_MIN_HEIGHT = 714;
const LEGACY_MAX_HEIGHT = 1162;
function measure() {
	const element = textarea.value;
	const container = wrapper.value;
	if (!props.open || !element || !container || !element.offsetWidth) return;
	const style = getComputedStyle(container);
	const frame =
		Number.parseFloat(style.paddingTop) +
		Number.parseFloat(style.paddingBottom) +
		Number.parseFloat(style.borderTopWidth) +
		Number.parseFloat(style.borderBottomWidth);
	const width = element.getBoundingClientRect().width;
	if (measuredWidth !== null && width !== measuredWidth) legacyMeasurement.value = false;
	measuredWidth = width;
	const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 22;
	minimum.value = legacyMeasurement.value ? LEGACY_MIN_HEIGHT - frame : lineHeight * 22;
	maximum.value = legacyMeasurement.value ? LEGACY_MAX_HEIGHT - frame : lineHeight * 36;
	if (!probe) {
		probe = document.createElement("textarea");
		probe.setAttribute("aria-hidden", "true");
		probe.tabIndex = -1;
		Object.assign(probe.style, {
			position: "absolute",
			visibility: "hidden",
			height: "0px",
			minHeight: "0px",
			maxHeight: "none",
			overflow: "hidden",
			padding: "0px",
			border: "0px",
			boxSizing: "border-box",
			top: "0px",
			left: "-10000px",
			pointerEvents: "none",
		});
		document.body.appendChild(probe);
	}
	const inputStyle = getComputedStyle(element);
	for (const key of [
		"fontFamily",
		"fontSize",
		"fontWeight",
		"fontStyle",
		"lineHeight",
		"letterSpacing",
		"textIndent",
		"wordBreak",
		"overflowWrap",
	] as const)
		probe.style[key] = inputStyle[key];
	probe.style.width = width + "px";
	probe.value = props.modelValue || " ";
	const naturalHeight = probe.scrollHeight;
	height.value = Math.min(maximum.value, Math.max(minimum.value, naturalHeight));
	overflowing.value = naturalHeight > maximum.value;
	element.style.minHeight = minimum.value + "px";
	element.style.height = height.value + "px";
}
function update(event: Event) {
	emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
	void nextTick(measure);
}
onMounted(() => {
	if (typeof ResizeObserver !== "undefined" && textarea.value) {
		observer = new ResizeObserver(measure);
		observer.observe(textarea.value);
	}
	window.addEventListener("resize", measure);
	void nextTick(measure);
});
onBeforeUnmount(() => {
	observer?.disconnect();
	probe?.remove();
	probe = undefined;
	window.removeEventListener("resize", measure);
});
watch(
	() => props.open,
	(open) => {
		if (open) {
			if (hasOpened) legacyMeasurement.value = false;
			hasOpened = true;
		}
	},
);
watch(
	() => [props.modelValue, props.open],
	() => void nextTick(measure),
	{ flush: "post" },
);
</script>
<template>
	<div
		ref="wrapper"
		class="ui-input-wrapper ui-input-wrapper--middle ui-input-wrapper--antd ui-input-wrapper--multiline cp-mono cp-raw-config-input"
	>
		<textarea
			ref="textarea"
			class="ui-input"
			:value="modelValue"
			:rows="22"
			:spellcheck="false"
			:style="{
				height: height + 'px',
				minHeight: minimum + 'px',
				maxHeight: maximum + 'px',
				overflowY: overflowing ? 'auto' : 'hidden',
				resize: 'none',
			}"
			@input="update"
		/>
	</div>
</template>
