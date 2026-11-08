<script setup lang="ts">
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { convertExecutor, moveExecutor } from "../logic/ExecutorChainLogic";
import type { CapabilityExecutor, Choice, DeepSeekExecutor, ModelExecutor } from "../support/BuiltinCapabilitiesModels";
const props = defineProps<{
	modelValue?: CapabilityExecutor[];
	modelOptions: Choice[];
	credentialOptions: Choice[];
	allowDeepSeekTools: boolean;
	emptyHint: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: CapabilityExecutor[]] }>();
const options = [
	{ label: "LiteLLM model", value: "model" },
	{ label: "DeepSeek Search & Fetch (direct)", value: "deepseek_tools" },
];
function replace(index: number, value: CapabilityExecutor) {
	emit(
		"update:modelValue",
		(props.modelValue ?? []).map((row, i) => (i === index ? value : row)),
	);
}
function patch(index: number, values: Partial<DeepSeekExecutor> | Partial<ModelExecutor>) {
	const current = props.modelValue?.[index];
	if (current) replace(index, { ...current, ...values } as CapabilityExecutor);
}
function remove(index: number) {
	emit(
		"update:modelValue",
		(props.modelValue ?? []).filter((_, i) => i !== index),
	);
}
function move(index: number, direction: -1 | 1) {
	emit("update:modelValue", moveExecutor(props.modelValue ?? [], index, direction));
}
function add(type: "model" | "deepseek_tools") {
	emit("update:modelValue", [...(props.modelValue ?? []), convertExecutor(type)]);
}
function last(value: string | number | (string | number)[] | null) {
	return Array.isArray(value) ? String(value[value.length - 1] ?? "") : String(value ?? "");
}
</script>
<template>
	<div class="builtin-chain">
		<span v-if="!modelValue?.length" class="builtin-secondary">{{ emptyHint }}</span>
		<div v-for="(executor, index) in modelValue" :key="index" class="builtin-executor">
			<div class="builtin-executor-header">
				<div class="builtin-executor-kind">
					<span class="builtin-secondary builtin-xs">#{{ index + 1 }}</span
					><UiSelect
						:model-value="executor.type"
						:options="options.filter((row) => allowDeepSeekTools || row.value !== 'deepseek_tools')"
						:aria-label="'Executor type ' + (index + 1)"
						style="width: 288px"
						@update:model-value="
							replace(index, convertExecutor($event === 'deepseek_tools' ? 'deepseek_tools' : 'model', executor))
						"
					/>
				</div>
				<div class="builtin-executor-actions">
					<UiTooltip title="Move up"
						><UiButton
							size="small"
							:aria-label="'Move executor ' + (index + 1) + ' up'"
							:disabled="index === 0"
							@click="move(index, -1)"
							>↑</UiButton
						></UiTooltip
					>
					<UiTooltip title="Move down"
						><UiButton
							size="small"
							:aria-label="'Move executor ' + (index + 1) + ' down'"
							:disabled="index === (modelValue?.length ?? 0) - 1"
							@click="move(index, 1)"
							>↓</UiButton
						></UiTooltip
					>
					<UiTooltip title="Remove"
						><UiButton size="small" :aria-label="'Remove executor ' + (index + 1)" @click="remove(index)"
							><template #icon><UiIcon name="DeleteOutlined" /></template></UiButton
					></UiTooltip>
				</div>
			</div>
			<div v-if="executor.type === 'model'" class="builtin-executor-grid">
				<div>
					<span class="builtin-small-label">Model</span
					><UiSelect
						:model-value="executor.model || null"
						:options="modelOptions"
						searchable
						clearable
						placeholder="Select a routable model"
						:aria-label="'Model for executor ' + (index + 1)"
						@update:model-value="patch(index, { model: last($event) })"
					/>
				</div>
				<div>
					<span class="builtin-small-label">Output token limit (optional)</span
					><UiInputNumber
						:model-value="executor.max_output_tokens"
						:min="128"
						:step="128"
						placeholder="Uses the capability default"
						:aria-label="'Output token limit for executor ' + (index + 1)"
						@update:model-value="$event !== null && patch(index, { max_output_tokens: $event })"
					/>
				</div>
			</div>
			<div v-else class="builtin-executor-grid">
				<div>
					<span class="builtin-small-label">Credential</span
					><UiSelect
						:model-value="executor.credential_name || null"
						:options="credentialOptions"
						searchable
						clearable
						placeholder="Select a stored DeepSeek credential"
						:aria-label="'Credential for executor ' + (index + 1)"
						@update:model-value="patch(index, { credential_name: last($event) })"
					/>
				</div>
				<div>
					<span class="builtin-small-label">API base</span
					><UiSelect
						:model-value="[executor.api_base]"
						:options="[{ value: 'https://api.deepseek.com', label: 'https://api.deepseek.com' }]"
						multiple
						creatable
						searchable
						:aria-label="'API base for executor ' + (index + 1)"
						@update:model-value="patch(index, { api_base: last($event) })"
					/>
				</div>
				<div>
					<span class="builtin-small-label">Results per search</span
					><UiInputNumber
						:model-value="executor.search_count"
						:min="1"
						:max="50"
						:aria-label="'Search result count for executor ' + (index + 1)"
						@update:model-value="patch(index, { search_count: $event ?? 10 })"
					/>
				</div>
				<div>
					<span class="builtin-small-label">Request timeout (ms)</span
					><UiInputNumber
						:model-value="executor.timeout_ms"
						:min="1000"
						:max="120000"
						:step="1000"
						:aria-label="'Timeout for executor ' + (index + 1)"
						@update:model-value="patch(index, { timeout_ms: $event ?? 15000 })"
					/>
				</div>
				<div class="builtin-executor-include">
					<span class="builtin-small-label">Include full page content in results</span
					><UiSwitch
						:model-value="executor.search_need_content"
						:aria-label="'Include content for executor ' + (index + 1)"
						@update:model-value="patch(index, { search_need_content: $event })"
					/>
				</div>
				<div>
					<span class="builtin-small-label">Localization (optional)</span
					><UiSelect
						:model-value="executor.localization ? [executor.localization] : []"
						:options="[]"
						multiple
						creatable
						searchable
						placeholder="e.g. CN"
						:aria-label="'Localization for executor ' + (index + 1)"
						@update:model-value="patch(index, { localization: Array.isArray($event) ? String($event[0] ?? '') : '' })"
					/>
				</div>
			</div>
		</div>
		<div class="builtin-add-executor">
			<UiButton size="small" @click="add('model')"
				><template #icon><UiIcon name="PlusOutlined" /></template>Add model executor</UiButton
			><UiButton v-if="allowDeepSeekTools" size="small" @click="add('deepseek_tools')"
				><template #icon><UiIcon name="PlusOutlined" /></template>Add DeepSeek Search &amp; Fetch</UiButton
			>
		</div>
	</div>
</template>
