<script setup lang="ts">
import { ref } from "vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
const props = defineProps<{ modelValue?: Record<string, unknown>; query?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: Record<string, string>] }>();
const pairs = ref(Object.entries(props.modelValue ?? {}).map(([key, value]) => [key, String(value)]));
function update(index: number, position: number, value: string | number | null) {
	pairs.value[index][position] = String(value ?? "");
	emit("update:modelValue", Object.fromEntries(pairs.value));
}
function remove(index: number) {
	pairs.value.splice(index, 1);
	emit("update:modelValue", Object.fromEntries(pairs.value));
}
</script>
<template>
	<div>
		<div v-for="(pair, index) in pairs" :key="index" class="model-pass-pair">
			<UiInput
				:model-value="pair[0]"
				appearance="tremor"
				:placeholder="query ? 'Parameter Name (e.g., version)' : 'Header Name'"
				@update:model-value="update(index, 0, $event)"
			/><UiInput
				:model-value="pair[1]"
				appearance="tremor"
				:placeholder="query ? 'Parameter Value (e.g., v1)' : 'Header Value'"
				@update:model-value="update(index, 1, $event)"
			/><button
				type="button"
				class="model-icon-button"
				:aria-label="'Remove ' + (query ? 'parameter' : 'header') + ' ' + (index + 1)"
				@click="remove(index)"
			>
				<UiIcon name="MinusCircleOutlined" />
			</button>
		</div>
		<UiButton class="model-dashed-button" @click="pairs.push(['', ''])"
			><template #icon><UiIcon name="PlusOutlined" /></template>{{ query ? "Add Query Parameter" : "Add Header" }}</UiButton
		>
	</div>
</template>
