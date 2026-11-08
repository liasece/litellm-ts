<script setup lang="ts">
import { computed, ref } from "vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiButton from "../../platform/ui/UiButton.vue";
const value = defineModel<string>({ default: "" });
const props = defineProps<{ options: string[]; placeholder: string; inputLabel: string }>();
const custom = ref(false);
const options = computed(() => [
	{ value: "__custom__", label: "自定义取值（手动输入）" },
	...[...new Set([value.value, ...props.options])].filter(Boolean).map((value) => ({ value, label: value })),
]);
</script>
<template>
	<div v-if="custom">
		<UiInput v-model="value" appearance="tremor" :placeholder="placeholder" :aria-label="inputLabel" /><UiButton
			variant="link"
			size="small"
			class="model-suggestion-back"
			@click="custom = false"
			>从已知候选中选择</UiButton
		>
	</div>
	<UiSelect
		v-else
		:model-value="value || null"
		:options="options"
		searchable
		clearable
		:placeholder="placeholder"
		:aria-label="inputLabel"
		@update:model-value="$event === '__custom__' ? (custom = true) : (value = String($event ?? ''))"
	/>
</template>
