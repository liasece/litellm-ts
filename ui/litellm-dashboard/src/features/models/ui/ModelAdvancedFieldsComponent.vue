<script setup lang="ts">
import { computed, ref } from "vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import ModelField from "./ModelFormFieldComponent.vue";
import type { ModelCreateDraft } from "../logic/ModelCreateLogic";
import { modelInput, modelString, modelRecord, type ModelCatalog } from "../support/ModelModels";
const values = defineModel<ModelCreateDraft>({ required: true });
defineProps<{ catalog: ModelCatalog; errors: Record<string, string>; prefix: string }>();
const extraPlaceholder = '{ "rpm": 100, "timeout": 0, "stream_timeout": 0 }';
const infoPlaceholder = '{ "mode": "chat" }';
const open = ref(false),
	customPricing = ref(false),
	pricingModel = ref("per_token"),
	cacheControl = ref(false);
const points = computed(() =>
	Array.isArray(values.value.cache_control_injection_points) ? values.value.cache_control_injection_points.map(modelRecord) : [],
);
function toggleCache(enabled: boolean) {
	cacheControl.value = enabled;
	values.value.cache_control = enabled;
	if (enabled && !values.value.cache_control_injection_points) values.value.cache_control_injection_points = [{ location: "message" }];
}
function point(index: number, key: string, value: unknown) {
	const next = points.value.map((item) => ({ ...item }));
	next[index][key] = value;
	values.value.cache_control_injection_points = next;
}
function remove(index: number) {
	values.value.cache_control_injection_points = points.value.filter((_, position) => position !== index);
}
</script>
<template>
	<div class="model-accordion model-advanced" :class="{ 'model-accordion--open': open }">
		<button type="button" class="model-accordion-header" :aria-expanded="open" @click="open = !open">
			<strong>Advanced Settings</strong
			><svg viewBox="0 0 24 24" fill="currentColor">
				<path d="M11.9999 10.8284L7.0502 15.7782L5.63599 14.364L11.9999 8L18.3639 14.364L16.9497 15.7782L11.9999 10.8284Z" />
			</svg>
		</button>
		<div v-if="open" class="model-accordion-body">
			<ModelField label="Custom Pricing" :id="prefix + '-pricing'" class="model-field--mb16 model-switch-field"
				><UiSwitch
					:id="prefix + '-pricing'"
					v-model="customPricing"
					class="model-custom-pricing-toggle"
					@update:model-value="values.custom_pricing = $event"
			/></ModelField>
			<div v-if="customPricing" class="model-indented-fields">
				<ModelField label="Pricing Model" :id="prefix + '-pricing-mode'" class="model-field--mb16"
					><UiSelect
						:id="prefix + '-pricing-mode'"
						v-model="pricingModel"
						:options="[
							{ value: 'per_token', label: 'Per Million Tokens' },
							{ value: 'per_second', label: 'Per Second' },
						]"
						@update:model-value="values.pricing_model = $event" /></ModelField
				><template v-if="pricingModel === 'per_token'"
					><ModelField
						v-for="field in [
							{ key: 'input_cost_per_token', label: 'Input Cost (USD / 1M tokens)' },
							{ key: 'output_cost_per_token', label: 'Output Cost (USD / 1M tokens)' },
						]"
						:key="field.key"
						:label="field.label"
						:id="prefix + '-' + field.key"
						:error="errors[field.key]"
						class="model-field--mb16"
						><UiInput
							:id="prefix + '-' + field.key"
							:model-value="modelInput(values[field.key])"
							appearance="tremor"
							@update:model-value="values[field.key] = $event" /></ModelField></template
				><ModelField
					v-else
					label="Cost Per Second (USD)"
					:id="prefix + '-seconds'"
					:error="errors.input_cost_per_second"
					class="model-field--mb16"
					><UiInput
						:id="prefix + '-seconds'"
						:model-value="modelInput(values.input_cost_per_second)"
						appearance="tremor"
						@update:model-value="values.input_cost_per_second = $event"
				/></ModelField>
			</div>
			<ModelField
				label="Cache Control Injection Points"
				:id="prefix + '-cache'"
				tooltip="Tell litellm where to inject cache control checkpoints. You can specify either by role (to apply to all messages of that role) or by specific message index."
				class="model-field--mb16"
				><UiSwitch :id="prefix + '-cache'" :model-value="cacheControl" @update:model-value="toggleCache"
			/></ModelField>
			<div v-if="cacheControl" class="model-indented-fields">
				<p class="model-text model-cache-explanation">
					Providers like Anthropic, Bedrock API require users to specify where to inject cache control checkpoints, litellm can
					automatically add them for you as a cost saving feature.
				</p>
				<div v-for="(item, index) in points" :key="index" class="model-cache-point">
					<ModelField label="Type"
						><UiSelect model-value="message" :options="[{ value: 'message', label: 'Message' }]" disabled /></ModelField
					><ModelField label="Role" tooltip="LiteLLM will mark all messages of this role as cacheable"
						><UiSelect
							:model-value="modelString(item.role) || null"
							:options="[
								{ value: 'user', label: 'User' },
								{ value: 'system', label: 'System' },
								{ value: 'assistant', label: 'Assistant' },
							]"
							clearable
							placeholder="Select a role"
							@update:model-value="point(index, 'role', $event)" /></ModelField
					><ModelField label="Index" tooltip="(Optional) If set litellm will mark the message at this index as cacheable"
						><UiInputNumber
							:model-value="typeof item.index === 'number' ? item.index : null"
							appearance="tremor"
							placeholder="Optional"
							:step="1"
							@update:model-value="point(index, 'index', $event)" /></ModelField
					><button
						v-if="points.length > 1"
						type="button"
						class="model-icon-button model-error"
						:aria-label="'Remove injection point ' + (index + 1)"
						@click="remove(index)"
					>
						<UiIcon name="MinusCircleOutlined" :size="18" />
					</button>
				</div>
				<UiButton
					block
					class="model-dashed-button"
					@click="values.cache_control_injection_points = [...points, { location: 'message' }]"
					><template #icon><UiIcon name="PlusOutlined" /></template>Add Injection Point</UiButton
				>
			</div>
			<ModelField
				label="LiteLLM Params"
				:id="prefix + '-extra'"
				tooltip="Optional litellm params used for making a litellm.completion() call."
				:error="errors.litellm_extra_params"
				class="model-field--mb16"
				><UiInput
					:id="prefix + '-extra'"
					:model-value="modelString(values.litellm_extra_params)"
					multiline
					:rows="4"
					:placeholder="extraPlaceholder"
					@update:model-value="values.litellm_extra_params = $event"
				/>
				<p class="model-field__help">
					Pass JSON of litellm supported params
					<a href="https://docs.litellm.ai/docs/completion/input" target="_blank" rel="noreferrer">litellm.completion() call</a>
				</p></ModelField
			><ModelField
				label="Model Info"
				:id="prefix + '-info'"
				tooltip="Optional model info params. Returned when calling '/model/info' endpoint."
				:error="errors.model_info_params"
				class="model-field--mb0"
				><UiInput
					:id="prefix + '-info'"
					:model-value="modelString(values.model_info_params)"
					multiline
					:rows="4"
					:placeholder="infoPlaceholder"
					@update:model-value="values.model_info_params = $event"
			/></ModelField>
		</div>
	</div>
</template>
