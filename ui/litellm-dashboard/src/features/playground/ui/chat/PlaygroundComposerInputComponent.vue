<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import UiInput from "../../../platform/ui/UiInput.vue";
const props = defineProps<{ modelValue: string; placeholder: string; disabled?: boolean }>(),
	emit = defineEmits<{ "update:modelValue": [string]; keydown: [KeyboardEvent] }>(),
	input = ref<InstanceType<typeof UiInput>>(),
	pristine = ref(!props.modelValue);
let observer: ResizeObserver | undefined,
	initialWidth = 0;
watch(
	() => props.modelValue,
	(value) => {
		if (value) pristine.value = false;
	},
);
function update(value: string | number | null) {
	emit("update:modelValue", String(value ?? ""));
}
function edited() {
	pristine.value = false;
}
onMounted(async () => {
	await nextTick();
	const element = input.value?.$el as HTMLElement | undefined;
	if (!element) return;
	initialWidth = element.getBoundingClientRect().width;
	observer = new ResizeObserver(() => {
		const width = element.getBoundingClientRect().width;
		if (width > 0) {
			if (initialWidth > 0 && Math.abs(width - initialWidth) > 0.5) pristine.value = false;
			initialWidth = width;
		}
	});
	observer.observe(element);
});
onBeforeUnmount(() => observer?.disconnect());
</script>
<template>
	<UiInput
		ref="input"
		:model-value="modelValue"
		:placeholder="placeholder"
		:disabled="disabled"
		multiline
		:rows="pristine ? 1 : 2"
		:auto-size="pristine ? false : { minRows: 1, maxRows: 4 }"
		class="pg-composer__textarea"
		:class="{ 'pg-composer__textarea--pristine': pristine, 'pg-composer__textarea--empty': !modelValue }"
		@update:model-value="update"
		@input="edited"
		@keydown="emit('keydown', $event)"
	/>
</template>
<style>
.pg-composer__textarea--pristine textarea {
	height: 28px;
	min-height: 28px;
	max-height: 88px;
	overflow-y: hidden;
	resize: none;
}
.pg-composer__textarea--empty textarea {
	text-overflow: ellipsis;
}
</style>
