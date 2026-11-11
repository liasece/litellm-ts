<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import type { FallbackGroup } from "../support/RouterSettingsModels";
const props = defineProps<{ models: string[] }>();
const groups = defineModel<FallbackGroup[]>({ required: true });
const active = ref("1");
let sequence = 0;
const current = computed(() => groups.value.find((group) => group.id === active.value) || groups.value[0]);
watch(
	() => groups.value,
	() => {
		if (!groups.value.some((group) => group.id === active.value)) active.value = groups.value[0]?.id || "1";
	},
	{ deep: true, immediate: true },
);
function add() {
	if (groups.value.length >= 5) return;
	const id = "fallback-" + ++sequence;
	groups.value = [...groups.value, { id, primary: "", models: [] }];
	active.value = id;
}
function remove(id: string) {
	if (groups.value.length <= 1) return;
	groups.value = groups.value.filter((group) => group.id !== id);
	if (active.value === id) active.value = groups.value.at(-1)?.id || "1";
}
function primary(value: unknown) {
	if (!current.value) return;
	current.value.primary = typeof value === "string" ? value : "";
	current.value.models = current.value.models.filter((model) => model !== current.value?.primary);
}
function changeFallbackModels(value: unknown) {
	if (current.value)
		current.value.models = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 10) : [];
}
</script>
<template>
	<div class="routing-fallback-editor">
		<div class="routing-fallback-tabs" role="tablist">
			<button
				v-for="(group, index) in groups"
				:key="group.id"
				type="button"
				role="tab"
				:aria-selected="active === group.id"
				:class="{ active: active === group.id }"
				@click="active = group.id"
			>
				<ModelName :model="group.primary" :name="group.primary || 'Group ' + (index + 1)" :size="14" /><span
					v-if="groups.length > 1"
					role="button"
					tabindex="0"
					aria-label="Remove fallback group"
					@click.stop="remove(group.id)"
					@keydown.enter.stop="remove(group.id)"
					><UiIcon name="CloseOutlined" :size="12"
				/></span></button
			><button v-if="groups.length < 5" type="button" aria-label="Add fallback group" @click="add">
				<UiIcon name="PlusOutlined" />
			</button>
		</div>
		<div v-if="current" class="routing-fallback-group">
			<section>
				<label>Primary Model <b>*</b></label
				><UiSelect
					:model-value="current.primary || null"
					:options="props.models.map((value) => ({ value, label: value }))"
					size="large"
					searchable
					placeholder="Select primary model"
					aria-label="Primary Model"
					@update:model-value="primary"
				/>
				<p v-if="!current.primary" class="routing-fallback-warning">
					<UiLucideIcon name="AlertCircle" :size="16" />Select a model to begin configuring fallbacks
				</p>
			</section>
			<div class="routing-fallback-connection">
				<span><UiLucideIcon name="ArrowDown" :size="16" />IF FAILS, TRY...</span>
			</div>
			<section :class="{ 'routing-fallback-disabled': !current.primary }">
				<label>Fallback Chain <b>*</b><small>(Max 10 fallbacks at a time)</small></label>
				<div class="routing-fallback-chain">
					<UiSelect
						:model-value="current.models"
						max-tag-count="responsive"
						:options="props.models.filter((model) => model !== current?.primary).map((value) => ({ value, label: value }))"
						multiple
						searchable
						size="large"
						:disabled="!current.primary"
						:placeholder="current.models.length < 10 ? 'Select fallback models to add...' : 'Maximum 10 fallbacks reached'"
						aria-label="Fallback Chain"
						@update:model-value="changeFallbackModels"
						><template #option="{ option }"
							><span v-if="current.models.includes(String(option.value))" class="routing-fallback-option-order">{{
								current.models.indexOf(String(option.value)) + 1
							}}</span
							>{{ option.label }}</template
						><template #overflow="{ options, count }"
							><UiTooltip
								:title="options.map((option) => option.value).join(', ')"
								popup-class="routing-fallback-overflow-tooltip"
								><span>+{{ count }} more</span></UiTooltip
							></template
						></UiSelect
					>
					<p>
						{{
							current.models.length < 10
								? "Search and select multiple models. Selected models will appear below in order. (" +
									current.models.length +
									"/10 used)"
								: "Maximum 10 fallbacks reached. Remove some to add more."
						}}
					</p>
					<div class="routing-fallback-selected">
						<div v-if="!current.models.length" class="routing-fallback-empty">
							<span>No fallback models selected</span><small>Add models from the dropdown above</small>
						</div>
						<div v-for="(model, index) in current.models" :key="model" class="routing-fallback-model">
							<span class="routing-fallback-index">{{ index + 1 }}</span
							><ModelName :model="model" :size="16" variant="strong" /><button
								type="button"
								:aria-label="'Remove fallback ' + model"
								@click="changeFallbackModels(current.models.filter((_, position) => position !== index))"
							>
								<UiLucideIcon name="X" :size="16" />
							</button>
						</div>
					</div>
				</div>
			</section>
		</div>
	</div>
</template>
