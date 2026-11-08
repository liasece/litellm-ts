<script setup lang="ts">
import { ref } from "vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
const props = withDefaults(defineProps<{ modelValue: string[]; placeholder?: string; separators?: string[] }>(), {
		placeholder: undefined,
		separators: () => [","],
	}),
	emit = defineEmits<{ "update:modelValue": [value: string[]] }>();
const text = ref(""),
	input = ref<HTMLInputElement>();
function commit() {
	const value = text.value.trim();
	if (value && !props.modelValue.includes(value)) emit("update:modelValue", [...props.modelValue, value]);
	text.value = "";
}
function change() {
	if (props.separators.some((separator) => text.value.includes(separator))) {
		const values = props.separators.reduce((parts, separator) => parts.flatMap((p) => p.split(separator)), [text.value]);
		const last = values.pop() ?? "";
		emit("update:modelValue", [...new Set([...props.modelValue, ...values.map((v) => v.trim()).filter(Boolean)])]);
		text.value = last;
	}
}
function key(event: KeyboardEvent) {
	if (event.key === "Enter") {
		event.preventDefault();
		commit();
	} else if (event.key === "Backspace" && !text.value) emit("update:modelValue", props.modelValue.slice(0, -1));
}
</script>
<template>
	<div class="policy-tag-input" @click="input?.focus()">
		<span v-for="(value, index) in modelValue" :key="value"
			>{{ value
			}}<button
				type="button"
				:aria-label="'Remove ' + value"
				@click.stop="
					$emit(
						'update:modelValue',
						modelValue.filter((_, i) => i !== index),
					)
				"
			>
				<UiIcon name="CloseOutlined" :size="10" /></button></span
		><input
			ref="input"
			v-model="text"
			:placeholder="modelValue.length ? undefined : placeholder"
			role="combobox"
			aria-expanded="false"
			@input="change"
			@keydown="key"
			@blur="commit"
		/>
	</div>
</template>
