<script setup lang="ts">
import { ref } from "vue";
import ModelSelectorComponent from "../../model-selection/ui/ModelSelectorComponent.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
withDefaults(defineProps<{ model: string; temperature?: number; maxTokens?: number }>(), { temperature: 1, maxTokens: 1000 });
const emit = defineEmits<{ "update:model": [value: string]; "update:temperature": [value: number]; "update:maxTokens": [value: number] }>(),
	open = ref(false);
function temperatureValue(value: string | number | null) {
	emit("update:temperature", parseFloat(String(value)) || 0);
}
function tokenValue(value: string | number | null) {
	emit("update:maxTokens", parseInt(String(value)) || 1000);
}
</script>
<template>
	<div class="prompt-model-config">
		<div><ModelSelectorComponent :model-value="model" :show-label="false" @update:model-value="emit('update:model', $event)" /></div>
		<button type="button" @click="open = !open"><UiLucideIcon name="SettingsIcon" :size="16" /><span>Parameters</span></button
		><UiDialog
			v-model:open="open"
			centered
			:width="384"
			:show-footer="false"
			:closable="false"
			:mask-closable="false"
			class="prompt-parameters-dialog"
			><header>
				<h3>Model Parameters</h3>
				<button type="button" aria-label="Close" @click="open = false">✕</button>
			</header>
			<div>
				<label>Temperature</label
				><UiInput
					:model-value="temperature"
					type="number"
					size="small"
					:min="0"
					:max="2"
					:step="0.1"
					style="width: 80px"
					@update:model-value="temperatureValue"
				/>
			</div>
			<div>
				<label>Max Tokens</label
				><UiInput
					:model-value="maxTokens"
					type="number"
					size="small"
					:min="1"
					:max="32768"
					style="width: 96px"
					@update:model-value="tokenValue"
				/></div
		></UiDialog>
	</div>
</template>
