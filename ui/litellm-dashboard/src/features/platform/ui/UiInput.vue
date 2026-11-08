<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useAttrs, watch, type StyleValue } from "vue";
import UiIcon from "./UiIcon.vue";
import passwordPaths from "./UiTremorPasswordIconDefinitions.json";
import type { UiAppearance, UiControlSize } from "./UiTypes";

defineOptions({ inheritAttrs: false });
const props = withDefaults(
	defineProps<{
		modelValue?: string | number | null;
		type?: string;
		multiline?: boolean;
		rows?: number;
		autoSize?: boolean | { minRows?: number; maxRows?: number };
		size?: UiControlSize;
		appearance?: UiAppearance;
		status?: "error" | "warning";
		disabled?: boolean;
		clearable?: boolean;
		visibilityToggle?: boolean;
	}>(),
	{
		visibilityToggle: undefined,
		autoSize: undefined,
		status: undefined,
		modelValue: undefined,
		type: "text",
		rows: 4,
		size: "middle",
		appearance: "antd",
	},
);
const emit = defineEmits<{ "update:modelValue": [value: string | number | null]; input: [event: Event] }>();
const attrs = useAttrs();
const textarea = ref<HTMLTextAreaElement>();
const passwordVisible = ref(false);
let resizeObserver: ResizeObserver | undefined;
function resizeTextarea() {
	const element = textarea.value;
	if (!element) return;
	if (!props.autoSize) {
		for (const key of ["height", "minHeight", "maxHeight", "overflowY", "resize"] as const) element.style[key] = "";
		return;
	}
	if (element.offsetWidth === 0) return;
	const style = getComputedStyle(element);
	const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5714285714;
	const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
	const border = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
	const options = typeof props.autoSize === "object" ? props.autoSize : {};
	const minimum = Math.max(1, options.minRows ?? 1) * lineHeight + padding + border;
	const maximum = Math.max(options.minRows ?? 1, options.maxRows ?? Infinity) * lineHeight + padding + border;
	const previousTransition = element.style.getPropertyValue("transition");
	const previousPriority = element.style.getPropertyPriority("transition");
	element.style.setProperty("transition", "none", "important");
	try {
		element.style.height = "0px";
		element.style.minHeight = minimum + "px";
		element.style.maxHeight = Number.isFinite(maximum) ? maximum + "px" : "";
		const naturalHeight = element.scrollHeight + border;
		element.style.height = Math.min(maximum, Math.max(minimum, naturalHeight)) + "px";
		element.style.overflowY = naturalHeight > maximum ? "auto" : "hidden";
		element.style.resize = "none";
		// Flush the final measured height before restoring the inherited transition.
		void element.offsetHeight;
	} finally {
		if (previousTransition) element.style.setProperty("transition", previousTransition, previousPriority);
		else element.style.removeProperty("transition");
	}
}
onMounted(() => {
	resizeTextarea();
	if (typeof ResizeObserver !== "undefined" && textarea.value) {
		resizeObserver = new ResizeObserver(resizeTextarea);
		resizeObserver.observe(textarea.value);
	}
	window.addEventListener("resize", resizeTextarea);
});
onBeforeUnmount(() => {
	resizeObserver?.disconnect();
	window.removeEventListener("resize", resizeTextarea);
});
watch(
	() => [props.modelValue, props.rows, props.autoSize],
	() => void nextTick(resizeTextarea),
	{ deep: true, flush: "post" },
);
function wrapperStyle(): StyleValue {
	return attrs.style as StyleValue;
}
function controlAttrs() {
	return { ...attrs, class: undefined, style: undefined };
}
function update(event: Event) {
	const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
	emit("update:modelValue", props.type === "number" ? (value === "" ? null : Number(value)) : value);
	emit("input", event);
	void nextTick(resizeTextarea);
}
</script>

<template>
	<div
		class="ui-input-wrapper"
		:class="[
			attrs.class,
			'ui-input-wrapper--' + size,
			'ui-input-wrapper--' + appearance,
			{
				'ui-input-wrapper--disabled': disabled,
				'ui-input-wrapper--error': status === 'error',
				'ui-input-wrapper--warning': status === 'warning',
				'ui-input-wrapper--multiline': multiline,
				'ui-input-wrapper--password': type === 'password' && (visibilityToggle ?? appearance === 'tremor'),
			},
		]"
		:style="wrapperStyle()"
	>
		<span v-if="$slots.prefix" class="ui-input__affix"><slot name="prefix" /></span>
		<textarea
			v-if="multiline"
			ref="textarea"
			v-bind="controlAttrs()"
			class="ui-input"
			:value="modelValue ?? ''"
			:rows="rows"
			:disabled="disabled"
			:aria-invalid="status === 'error' || undefined"
			@input="update"
		/>
		<input
			v-else
			v-bind="controlAttrs()"
			class="ui-input"
			:type="type === 'password' && passwordVisible ? 'text' : type"
			:value="modelValue ?? ''"
			:disabled="disabled"
			:aria-invalid="status === 'error' || undefined"
			@input="update"
		/>
		<button
			v-if="clearable && modelValue !== '' && modelValue != null && (!disabled || appearance === 'antd')"
			type="button"
			class="ui-input__clear"
			aria-label="Clear"
			@click="emit('update:modelValue', '')"
		>
			×
		</button>
		<button
			v-if="type === 'password' && (visibilityToggle ?? appearance === 'tremor') && (!disabled || appearance === 'antd')"
			type="button"
			class="ui-input__password-toggle"
			:disabled="disabled"
			:aria-label="passwordVisible ? 'Hide password' : 'Show Password'"
			@click="passwordVisible = !passwordVisible"
		>
			<svg v-if="appearance === 'tremor'" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
				<path :d="passwordPaths[passwordVisible ? 'EyeOffIcon' : 'EyeIcon']" />
			</svg>
			<UiIcon v-else :name="passwordVisible ? 'EyeOutlined' : 'EyeInvisibleOutlined'" :size="16" />
		</button>
		<span v-if="$slots.suffix" class="ui-input__affix"><slot name="suffix" /></span>
	</div>
</template>
