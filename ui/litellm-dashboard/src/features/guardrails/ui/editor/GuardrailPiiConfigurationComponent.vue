<script setup lang="ts">
import { ref, computed } from "vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiCheckbox from "../../../platform/ui/UiCheckbox.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
const props = withDefaults(
		defineProps<{
			entities: string[];
			actions: string[];
			selectedEntities: string[];
			selectedActions: Record<string, string>;
			entityCategories?: { category: string; entities: string[] }[];
		}>(),
		{ entityCategories: () => [] },
	),
	emit = defineEmits<{ entity: [entity: string]; action: [entity: string, action: string] }>(),
	categories = ref<string[]>([]),
	lookup = computed(
		() =>
			new Map(props.entityCategories.flatMap((category) => category.entities.map((entity) => [entity, category.category] as const))),
	),
	filtered = computed(() =>
		props.entities.filter((entity) => !categories.value.length || categories.value.includes(lookup.value.get(entity) || "")),
	);
function selectAll(action: string) {
	for (const entity of props.entities) {
		if (!props.selectedEntities.includes(entity)) emit("entity", entity);
		emit("action", entity, action);
	}
}
function category(value: unknown) {
	categories.value = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function action(entity: string, value: unknown) {
	if (typeof value === "string") emit("action", entity, value);
}
function icon(value: string) {
	return value === "MASK" ? "EyeInvisibleOutlined" : value === "BLOCK" ? "StopOutlined" : undefined;
}
</script>
<template>
	<div class="guardrail-pii">
		<header>
			<h2>Configure PII Protection</h2>
			<span>{{ selectedEntities.length }} items selected</span>
		</header>
		<div class="guardrail-pii-filters">
			<label><UiIcon name="FilterOutlined" />Filter by category</label
			><UiSelect
				:model-value="categories"
				:options="entityCategories.map((row) => ({ value: row.category, label: row.category }))"
				multiple
				clearable
				searchable
				placeholder="Select categories to filter by"
				@update:model-value="category"
			/>
			<div class="guardrail-pii-quick">
				<header>
					<div>
						<strong>Quick Actions</strong><UiTooltip title="Apply action to all PII types at once"><small>ⓘ</small></UiTooltip>
					</div>
					<UiButton
						danger
						:disabled="!selectedEntities.length"
						@click="[...selectedEntities].forEach((entity) => emit('entity', entity))"
						><UiIcon name="CloseOutlined" />Unselect All</UiButton
					>
				</header>
				<div>
					<UiButton class="guardrail-pii-mask" block @click="selectAll('MASK')"
						><UiIcon name="EyeInvisibleOutlined" />Select All &amp; Mask</UiButton
					><UiButton danger block @click="selectAll('BLOCK')"
						><template #icon><UiIcon name="StopOutlined" /></template>Select All &amp; Block</UiButton
					>
				</div>
			</div>
		</div>
		<div class="guardrail-pii-entity-table">
			<header><strong>PII Type</strong><strong>Action</strong></header>
			<div>
				<p v-if="!filtered.length">No PII types match your filter criteria</p>
				<div v-for="entity in filtered" :key="entity" :class="{ selected: selectedEntities.includes(entity) }">
					<div>
						<UiCheckbox
							:model-value="selectedEntities.includes(entity)"
							:label="entity"
							@update:model-value="emit('entity', entity)"
						/><span>{{ entity.replace(/_/g, " ") }}</span
						><UiTag v-if="lookup.get(entity)" color="blue">{{ lookup.get(entity) }}</UiTag>
					</div>
					<div>
						<UiSelect
							:model-value="selectedEntities.includes(entity) ? selectedActions[entity] || 'MASK' : 'MASK'"
							:options="actions.map((value) => ({ value, label: value }))"
							:disabled="!selectedEntities.includes(entity)"
							:class="{ unselected: !selectedEntities.includes(entity) }"
							style="width: 120px"
							@update:model-value="action(entity, $event)"
							><template #value="{ option }"
								><span class="guardrail-pii-action"
									><UiIcon v-if="icon(String(option.value))" :name="icon(String(option.value))" />{{ option.label }}</span
								></template
							><template #option="{ option }"
								><span class="guardrail-pii-action"
									><UiIcon v-if="icon(String(option.value))" :name="icon(String(option.value))" />{{ option.label }}</span
								></template
							></UiSelect
						>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
