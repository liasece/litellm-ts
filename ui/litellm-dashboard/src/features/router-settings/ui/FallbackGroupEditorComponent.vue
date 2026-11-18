<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import UiEntryCard from "../../platform/ui/UiEntryCard.vue";
import UiDragHandle from "../../platform/ui/UiDragHandle.vue";
import UiEntryRemove from "../../platform/ui/UiEntryRemove.vue";
import UiSortableList from "../../platform/ui/UiSortableList.vue";
import UiSectionCard from "../../platform/ui/UiSectionCard.vue";
import UiSwitchRow from "../../platform/ui/UiSwitchRow.vue";
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
	groups.value = [...groups.value, { id, primary: "", models: [], recurse: true }];
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
const fallbackCandidates = computed(() =>
	props.models.filter((model) => model !== current.value?.primary && !current.value?.models.includes(model)),
);
function addFallbackModel(value: unknown) {
	if (!current.value || typeof value !== "string" || !value) return;
	if (current.value.models.includes(value) || current.value.models.length >= 10) return;
	current.value.models = [...current.value.models, value];
}
function removeFallbackModel(name: string) {
	if (current.value) current.value.models = current.value.models.filter((model) => model !== name);
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
			<UiSectionCard title="Primary model" required>
				<UiSelect
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
			</UiSectionCard>
			<div class="routing-fallback-connection">
				<span><UiLucideIcon name="ArrowDown" :size="16" />IF FAILS, TRY...</span>
			</div>
			<UiSectionCard
				title="Fallback chain"
				description="Models are tried top to bottom after the primary model fails. Drag a row, or use ↑/↓ on its handle, to change that order."
			>
				<template #actions>
					<span class="routing-fallback-count">{{ current.models.length }}/10</span>
				</template>
				<UiSelect
					:model-value="null"
					:options="fallbackCandidates.map((value) => ({ value, label: value }))"
					searchable
					size="large"
					:disabled="!current.primary || current.models.length >= 10"
					:placeholder="current.models.length >= 10 ? 'Maximum 10 fallbacks reached' : 'Add a fallback model'"
					aria-label="Add fallback model"
					@update:model-value="addFallbackModel"
				/>
				<p v-if="!current.models.length" class="routing-fallback-hint">No fallback models yet — add one above.</p>
				<UiSortableList
					:items="current.models"
					:item-key="(model) => model"
					:label="(index, total) => 'fallback ' + (index + 1) + ' of ' + total"
					@update:items="current.models = $event"
				>
					<template #item="{ item: model, index, itemProps, itemClass, handleProps }">
						<UiEntryCard :index="index + 1" :class="itemClass" v-bind="itemProps">
							<template #handle><UiDragHandle v-bind="handleProps" /></template>
							<template #title><ModelName :model="model" :size="16" variant="strong" /></template>
							<template #actions>
								<UiEntryRemove :label="'Remove fallback ' + model" @click="removeFallbackModel(model)" />
							</template>
						</UiEntryCard>
					</template>
				</UiSortableList>
				<template #footer>
					<UiSwitchRow
						:model-value="current.recurse"
						:disabled="!current.primary"
						label="Let each fallback use its own chain"
						description="When off, a target that fails stops here instead of continuing to whatever that model falls back to."
						@update:model-value="current.recurse = $event"
					/>
				</template>
			</UiSectionCard>
		</div>
	</div>
</template>
