<script setup lang="ts">
import { computed, nextTick, normalizeStyle, ref, useAttrs, watch } from "vue";
import type { UiAppearance, UiControlSize } from "./UiTypes";

defineOptions({ inheritAttrs: false });
const props = withDefaults(
	defineProps<{
		modelValue?: number | null;
		min?: number;
		max?: number;
		step?: number;
		precision?: number;
		disabled?: boolean;
		size?: UiControlSize;
		appearance?: UiAppearance;
		placeholder?: string;
		formatter?: (value: number | string | null | undefined, info: { userTyping: boolean; input: string }) => string;
		parser?: (value: string | undefined) => number | string;
	}>(),
	{
		appearance: "antd",
		modelValue: null,
		min: -Infinity,
		max: Infinity,
		step: 1,
		size: "middle",
		precision: undefined,
		placeholder: undefined,
		formatter: undefined,
		parser: undefined,
	},
);
const emit = defineEmits<{
	"update:modelValue": [value: number | null];
	change: [value: number | null];
	blur: [event: FocusEvent];
	focus: [event: FocusEvent];
	pressEnter: [event: KeyboardEvent];
}>();
const attrs = useAttrs();
const input = ref<HTMLInputElement>();
const focused = ref(false);
const draft = ref(format(props.modelValue));
const inputAttrs = computed(() => ({ ...attrs, class: undefined, style: undefined }));
const value = computed(() => parse(draft.value));
const upDisabled = computed(() => props.disabled || (value.value !== null && value.value >= props.max));
const downDisabled = computed(() => props.disabled || (value.value !== null && value.value <= props.min));

function parse(text: string): number | null {
	const parsed = props.parser ? props.parser(text) : text.replace(/,/g, "");
	return String(parsed).trim() === "" ? null : Number(parsed);
}
function format(value: number | string | null | undefined, userTyping = false, text = "") {
	if (props.formatter) return props.formatter(value, { userTyping, input: text });
	return value == null ? "" : String(value);
}
function publish(next: number | null) {
	if (next === props.modelValue) return;
	emit("update:modelValue", next);
	emit("change", next);
}
function normalize(number: number) {
	const clamped = Math.min(props.max, Math.max(props.min, number));
	return props.precision == null ? clamped : Number(clamped.toFixed(Math.min(20, Math.max(0, props.precision))));
}
function commit() {
	const numeric = parse(draft.value);
	if (numeric === null) {
		draft.value = format(null);
		publish(null);
		return;
	}
	if (!Number.isFinite(numeric)) {
		draft.value = format(props.modelValue);
		return;
	}
	const next = normalize(numeric);
	const display = props.precision == null ? next : next.toFixed(Math.min(20, Math.max(0, props.precision)));
	draft.value = format(display, false, draft.value);
	publish(next);
}
function update(event: Event) {
	const control = event.target as HTMLInputElement;
	const text = control.value;
	const start = control.selectionStart ?? text.length;
	const before = text.slice(0, start),
		after = text.slice(control.selectionEnd ?? start);
	const numeric = parse(text);
	draft.value = props.formatter && (numeric === null || Number.isFinite(numeric)) ? format(numeric, true, text) : text;
	if (numeric === null) publish(null);
	else if (Number.isFinite(numeric) && numeric >= props.min && numeric <= props.max) publish(numeric);
	if (!props.formatter) return;
	control.value = draft.value;
	void nextTick(() => {
		if (!focused.value || document.activeElement !== control) return;
		const updated = control.value;
		let caret = updated.length;
		if (updated.startsWith(before)) caret = before.length;
		else if (updated.endsWith(after)) caret = updated.length - after.length;
		else {
			const nextIndex = updated.indexOf(before[start - 1] ?? "", Math.max(0, start - 1));
			if (nextIndex !== -1) caret = nextIndex + 1;
		}
		control.setSelectionRange(caret, caret);
	});
}
function handleStep(direction: 1 | -1) {
	if (direction > 0 ? upDisabled.value : downDisabled.value) return;
	const current = Number.isFinite(value.value) && value.value !== null ? value.value : 0;
	const raw = current + props.step * direction;
	const next = normalize(Number(raw.toFixed(Math.max(props.precision ?? 0, decimalPlaces(props.step), decimalPlaces(current)))));
	draft.value = format(next);
	publish(next);
	input.value?.focus();
}
function decimalPlaces(number: number) {
	const text = String(number).toLowerCase();
	const [coefficient, exponent] = text.split("e");
	return Math.min(20, Math.max(0, (coefficient.split(".")[1]?.length ?? 0) - Number(exponent ?? 0)));
}
function blur(event: FocusEvent) {
	focused.value = false;
	commit();
	if (input.value) input.value.value = draft.value;
	emit("blur", event);
}
function focus(event: FocusEvent) {
	focused.value = true;
	emit("focus", event);
}
function enter(event: KeyboardEvent) {
	commit();
	emit("pressEnter", event);
}
watch(
	() => props.modelValue,
	(next) => {
		if (!focused.value || (value.value !== next && !(value.value === null && next === null))) draft.value = format(next);
	},
);
watch(
	() => props.formatter,
	() => {
		if (!focused.value) draft.value = format(props.modelValue);
	},
);
defineExpose({ focus: () => input.value?.focus(), blur: () => input.value?.blur() });
</script>
<template>
	<div
		class="ui-input-number"
		:class="[
			'ui-input-number--' + size,
			'ui-input-number--' + appearance,
			attrs.class,
			{ 'ui-input-number--disabled': disabled, 'ui-input-number--focused': focused },
		]"
		:style="normalizeStyle(attrs.style)"
	>
		<input
			ref="input"
			v-bind="inputAttrs"
			role="spinbutton"
			class="ui-input-number__input"
			inputmode="decimal"
			autocomplete="off"
			:value="draft"
			:disabled="disabled"
			:placeholder="placeholder"
			:aria-valuemin="Number.isFinite(min) ? min : undefined"
			:aria-valuemax="Number.isFinite(max) ? max : undefined"
			:aria-valuenow="value !== null && Number.isFinite(value) ? value : undefined"
			@input="update"
			@blur="blur"
			@focus="focus"
			@keydown.up.prevent="handleStep(1)"
			@keydown.down.prevent="handleStep(-1)"
			@keydown.enter="enter"
			@wheel="appearance === 'tremor' && input?.blur()"
		/>
		<span v-if="appearance === 'tremor'" class="ui-input-number__tremor-handlers"
			><button
				type="button"
				aria-label="Decrease Value"
				tabindex="-1"
				:disabled="downDisabled"
				@mousedown.prevent
				@click="handleStep(-1)"
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
					<path d="M20 12H4" />
				</svg></button
			><button
				type="button"
				aria-label="Increase Value"
				tabindex="-1"
				:disabled="upDisabled"
				@mousedown.prevent
				@click="handleStep(1)"
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
					<path d="M12 4v16m8-8H4" />
				</svg></button
		></span>
		<span v-else class="ui-input-number__handlers"
			><button
				type="button"
				class="ui-input-number__handler ui-input-number__handler--up"
				aria-label="Increase Value"
				tabindex="-1"
				:disabled="upDisabled"
				@mousedown.prevent
				@click="handleStep(1)"
			>
				<svg viewBox="0 0 1024 1024" width="7" height="7" fill="currentColor" aria-hidden="true">
					<path
						d="M868 545.5L536.9 278c-14.5-11.7-35.3-11.7-49.8 0L156 545.5c-6.5 5.3-2.8 15.8 5.6 15.8h706.8c8.4 0 12.1-10.5 5.6-15.8z"
					/>
				</svg></button
			><button
				type="button"
				class="ui-input-number__handler ui-input-number__handler--down"
				aria-label="Decrease Value"
				tabindex="-1"
				:disabled="downDisabled"
				@mousedown.prevent
				@click="handleStep(-1)"
			>
				<svg viewBox="0 0 1024 1024" width="7" height="7" fill="currentColor" aria-hidden="true">
					<path
						d="M868 478.5L536.9 746c-14.5 11.7-35.3 11.7-49.8 0L156 478.5c-6.5-5.3-2.8-15.8 5.6-15.8h706.8c8.4 0 12.1 10.5 5.6 15.8z"
					/>
				</svg></button
		></span>
	</div>
</template>
