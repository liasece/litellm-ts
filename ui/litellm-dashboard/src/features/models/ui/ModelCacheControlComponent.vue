<script setup lang="ts">
import { computed } from "vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import ModelField from "./ModelFormFieldComponent.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { modelRecord, modelString } from "../support/ModelModels";
const draft = defineModel<Record<string, unknown>>({ required: true });
const points = computed(() =>
	Array.isArray(draft.value.cache_control_injection_points) ? draft.value.cache_control_injection_points.map(modelRecord) : [],
);
function point(index: number, key: string, value: unknown) {
	const next = points.value.map((item) => ({ ...item }));
	next[index][key] = value;
	draft.value.cache_control_injection_points = next;
}
</script>
<template>
	<div class="model-cache-control-edit">
		<ModelField
			label="Cache Control Injection Points"
			vertical
			class="model-field--mb16 model-cache-control-field"
			tooltip="Tell litellm where to inject cache control checkpoints. You can specify either by role (to apply to all messages of that role) or by specific message index."
		>
			<UiSwitch
				:model-value="Boolean(draft.cache_control)"
				aria-label="Cache Control Injection Points"
				class="model-cache-toggle"
				@update:model-value="draft.cache_control = $event"
			/>
		</ModelField>
		<div v-if="draft.cache_control" class="model-indented-fields">
			<p class="model-text model-cache-explanation">
				Providers like Anthropic, Bedrock API require users to specify where to inject cache control checkpoints, litellm can
				automatically add them for you as a cost saving feature.
			</p>
			<div v-for="(item, index) in points" :key="index" class="model-cache-point">
				<ModelField label="Type" vertical class="model-field--mb0"
					><UiSelect model-value="message" :options="[{ value: 'message', label: 'Message' }]" disabled
				/></ModelField>
				<ModelField
					label="Role"
					vertical
					class="model-field--mb0"
					tooltip="LiteLLM will mark all messages of this role as cacheable"
					><UiSelect
						:model-value="modelString(item.role) || null"
						:options="[
							{ value: 'user', label: 'User' },
							{ value: 'system', label: 'System' },
							{ value: 'assistant', label: 'Assistant' },
						]"
						clearable
						placeholder="Select a role"
						@update:model-value="point(index, 'role', $event)"
				/></ModelField>
				<ModelField
					label="Index"
					vertical
					class="model-field--mb0"
					tooltip="(Optional) If set litellm will mark the message at this index as cacheable"
					><UiInputNumber
						:model-value="typeof item.index === 'number' ? item.index : null"
						appearance="tremor"
						placeholder="Optional"
						:step="1"
						@update:model-value="point(index, 'index', $event)"
				/></ModelField>
				<button
					v-if="points.length > 1"
					type="button"
					class="model-icon-button model-error model-cache-point-remove"
					:aria-label="'Remove injection point ' + (index + 1)"
					@click="draft.cache_control_injection_points = points.filter((_, position) => position !== index)"
				>
					<UiIcon name="MinusCircleOutlined" :size="18" />
				</button>
			</div>
			<UiButton block class="model-dashed-button" @click="draft.cache_control_injection_points = [...points, { location: 'message' }]"
				><template #icon><UiIcon name="PlusOutlined" /></template>Add Injection Point</UiButton
			>
		</div>
	</div>
</template>

<style scoped>
.model-cache-control-field :deep(.model-field__control) {
	min-height: 32px;
	display: flex;
	align-items: center;
}
.model-cache-control-field :deep(.model-field__label .ui-popover-anchor) {
	margin-left: 4px;
}
.model-cache-toggle:not([aria-checked="true"]) {
	background: #4b5563;
}
.model-cache-point-remove {
	margin-left: 48px;
	padding: 0;
	font-size: 18px;
}
.model-cache-control-edit .model-dashed-button {
	height: auto;
	padding: 8px 16px;
	border: 1px dashed #d1d5db;
	border-radius: 4px;
	box-shadow: none;
	color: #4b5563;
}
</style>
