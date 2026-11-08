<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import type { FilterChoice, FilterOption, FilterValues } from "../support/FilterModels";

const props = withDefaults(defineProps<{ options: readonly FilterOption[]; values?: FilterValues; buttonLabel?: string }>(), {
	values: () => ({}),
	buttonLabel: "Filters",
});
const emit = defineEmits<{ apply: [values: FilterValues]; reset: [] }>();
const visible = ref(false);
const values = reactive<FilterValues>({ ...props.values });
const choices = reactive<Record<string, FilterChoice[]>>({});
const loading = reactive<Record<string, boolean>>({});
const initialized = new Set<string>();
const generations = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const order = [
	"Team ID",
	"Status",
	"Organization ID",
	"Key Alias",
	"User ID",
	"End User",
	"Error Code",
	"Error Message",
	"Key Hash",
	"Model",
];
const ordered = computed(() =>
	order.flatMap((name) => {
		const option = props.options.find((item) => item.label === name || item.name === name);
		return option ? [option] : [];
	}),
);
let disposed = false;
watch(
	() => props.values,
	(next) => {
		for (const key of Object.keys(values)) if (!(key in next)) delete values[key];
		Object.assign(values, next);
	},
	{ deep: true },
);
async function search(option: FilterOption, term: string): Promise<void> {
	const loader = option.searchFn ?? option.search;
	if (!loader) return;
	const generation = (generations.get(option.name) ?? 0) + 1;
	generations.set(option.name, generation);
	loading[option.name] = true;
	try {
		const result = await loader(term);
		if (!disposed && generations.get(option.name) === generation) choices[option.name] = result;
	} catch {
		if (!disposed && generations.get(option.name) === generation) choices[option.name] = [];
	} finally {
		if (!disposed && generations.get(option.name) === generation) loading[option.name] = false;
	}
}
function queueSearch(option: FilterOption, term: string): void {
	const old = timers.get(option.name);
	if (old !== undefined) clearTimeout(old);
	timers.set(
		option.name,
		setTimeout(() => {
			timers.delete(option.name);
			void search(option, term);
		}, 300),
	);
}
watch(visible, (open) => {
	if (!open) return;
	for (const option of props.options) {
		if ((option.isSearchable || option.search || option.searchFn) && !initialized.has(option.name)) {
			initialized.add(option.name);
			void search(option, "");
		}
	}
});
function update(name: string, value: unknown): void {
	values[name] = value == null ? "" : String(value);
	emit("apply", { ...values });
}
function reset(): void {
	for (const option of props.options) values[option.name] = "";
	emit("reset");
}
onUnmounted(() => {
	disposed = true;
	for (const timer of timers.values()) clearTimeout(timer);
	timers.clear();
});
</script>

<template>
	<div class="filter-bar">
		<div class="filter-bar-actions">
			<UiButton :aria-expanded="visible" @click="visible = !visible">
				<template #icon
					><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
						/></svg
				></template>
				{{ buttonLabel }}
			</UiButton>
			<UiButton @click="reset">Reset Filters</UiButton>
		</div>
		<div v-if="visible" class="filter-bar-fields">
			<div v-for="option in ordered" :key="option.name" class="filter-bar-field">
				<label>{{ option.label || option.name }}</label>
				<slot
					:name="'field-' + option.name"
					:option="option"
					:value="values[option.name]"
					:update="(value: unknown) => update(option.name, value)"
				>
					<component
						:is="option.component"
						v-if="option.component"
						:value="values[option.name] || undefined"
						:model-value="values[option.name] || null"
						:placeholder="'Select ' + (option.label || option.name) + '...'"
						@update:model-value="update(option.name, $event)"
					/>
					<UiSelect
						v-else-if="option.isSearchable || option.searchFn || option.search"
						:model-value="values[option.name] || null"
						:options="choices[option.name] ?? []"
						searchable
						clearable
						:filterable="false"
						:loading="loading[option.name]"
						:placeholder="'Search ' + (option.label || option.name) + '...'"
						@search="queueSearch(option, $event)"
						@update:model-value="update(option.name, $event)"
					/>
					<UiSelect
						v-else-if="option.options"
						:model-value="values[option.name] || null"
						:options="option.options"
						clearable
						:placeholder="'Select ' + (option.label || option.name) + '...'"
						@update:model-value="update(option.name, $event)"
					/>
					<UiInput
						v-else
						:model-value="values[option.name] || ''"
						clearable
						:placeholder="'Enter ' + (option.label || option.name) + '...'"
						@update:model-value="update(option.name, $event)"
					/>
				</slot>
			</div>
		</div>
	</div>
</template>

<style>
.filter-bar {
	width: 100%;
}
.filter-bar-actions {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 24px;
}
.filter-bar-fields {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	column-gap: 24px;
	row-gap: 16px;
	margin-bottom: 24px;
}
.filter-bar-field {
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.filter-bar-field > label {
	font-size: 14px;
	line-height: 20px;
	color: #4b5563;
}
</style>
