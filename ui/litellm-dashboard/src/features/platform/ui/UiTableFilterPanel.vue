<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import type { UiTableActiveFilter, UiTableFilterChoice, UiTableFilterField, UiTableFilterMatch } from "./UiTableFilterModels";
import { defaultFilterMatch } from "./UiTableFilterModels";

interface FilterDraft {
	value: string;
	text: string;
	match: UiTableFilterMatch;
}

const props = defineProps<{
	label: string;
	fields: readonly UiTableFilterField[];
	active: readonly UiTableActiveFilter[];
}>();
const emit = defineEmits<{ commit: [entries: UiTableActiveFilter[]]; cancel: [] }>();

const root = ref<HTMLElement>();
const drafts = reactive<Record<string, FilterDraft>>({});
const queries = reactive<Record<string, string>>({});
const choices = reactive<Record<string, UiTableFilterChoice[]>>({});
const loading = reactive<Record<string, boolean>>({});
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const generations = new Map<string, number>();
let disposed = false;

for (const field of props.fields) {
	const selected = props.active.find((filter) => filter.key === field.key);
	drafts[field.key] = {
		value: selected?.value ?? "",
		text: selected?.text ?? selected?.value ?? "",
		match: selected?.match ?? defaultFilterMatch(field),
	};
	queries[field.key] = "";
	const control = field.control;
	const seeded = control.kind === "select" ? [...control.options] : control.kind === "remote" ? [...(control.initialOptions ?? [])] : [];
	if (selected?.value && !seeded.some((choice) => choice.value === selected.value))
		seeded.unshift({ value: selected.value, label: selected.text || selected.value });
	choices[field.key] = seeded;
}

const hasFilters = computed(() => props.fields.some((field) => (drafts[field.key]?.value ?? "").trim()));

/** 枚举和远程筛选需要搜索框；选项很少的枚举直接列出，减少一次交互。 */
function showSearchInput(field: UiTableFilterField): boolean {
	const control = field.control;
	return control.kind === "remote" || (control.kind === "select" && Boolean(control.searchable || control.options.length > 8));
}

/** 本地枚举按输入过滤，远程结果已由调用方过滤。 */
function visibleChoices(field: UiTableFilterField): readonly UiTableFilterChoice[] {
	const list = choices[field.key] ?? [];
	const query = (queries[field.key] ?? "").trim().toLocaleLowerCase();
	if (!query || field.control.kind === "remote") return list;
	return list.filter((choice) => choice.label.toLocaleLowerCase().includes(query) || choice.value.toLocaleLowerCase().includes(query));
}

/** 允许把当前输入当作自定义枚举值提交。 */
function canCreate(field: UiTableFilterField): boolean {
	const control = field.control;
	if (control.kind !== "select" || !control.creatable) return false;
	const query = (queries[field.key] ?? "").trim();
	if (!query) return false;
	return !control.options.some(
		(choice) =>
			choice.value.toLocaleLowerCase() === query.toLocaleLowerCase() ||
			choice.label.toLocaleLowerCase() === query.toLocaleLowerCase(),
	);
}

function choose(field: UiTableFilterField, choice: UiTableFilterChoice): void {
	const draft = drafts[field.key];
	if (draft.value === choice.value) {
		draft.value = "";
		draft.text = "";
	} else {
		draft.value = choice.value;
		draft.text = choice.label;
	}
	queries[field.key] = "";
}

function useCustom(field: UiTableFilterField): void {
	const query = (queries[field.key] ?? "").trim();
	drafts[field.key].value = query;
	drafts[field.key].text = query;
	queries[field.key] = "";
}

function onTextInput(field: UiTableFilterField, event: Event): void {
	const value = (event.target as HTMLInputElement).value;
	drafts[field.key].value = value;
	drafts[field.key].text = value;
}

function onQueryInput(field: UiTableFilterField, event: Event): void {
	queries[field.key] = (event.target as HTMLInputElement).value;
	const control = field.control;
	if (control.kind !== "remote") return;
	const term = queries[field.key];
	const previous = timers.get(field.key);
	if (previous) clearTimeout(previous);
	timers.set(
		field.key,
		setTimeout(() => {
			timers.delete(field.key);
			void searchRemote(field, term);
		}, 250),
	);
}

/** 远程搜索保留上一代结果直到新结果返回，避免列表闪烁。 */
async function searchRemote(field: UiTableFilterField, term: string): Promise<void> {
	const control = field.control;
	if (control.kind !== "remote") return;
	const generation = (generations.get(field.key) ?? 0) + 1;
	generations.set(field.key, generation);
	loading[field.key] = true;
	try {
		const result = await control.search(term);
		if (disposed || generations.get(field.key) !== generation) return;
		const selected = drafts[field.key].value;
		const merged = [...result];
		if (selected && !merged.some((choice) => choice.value === selected)) {
			const active = props.active.find((filter) => filter.key === field.key);
			merged.unshift({ value: selected, label: active?.text || selected });
		}
		choices[field.key] = merged;
	} catch {
		if (!disposed && generations.get(field.key) === generation) choices[field.key] = [];
	} finally {
		if (!disposed && generations.get(field.key) === generation) loading[field.key] = false;
	}
}

/** 提交面板内所有字段；空值由调用方解释为清除该字段。 */
function commit(): void {
	emit(
		"commit",
		props.fields.map((field) => {
			const draft = drafts[field.key];
			const value = draft.value.trim();
			return {
				key: field.key,
				label: field.label,
				value,
				text: value ? draft.text.trim() || value : "",
				match: draft.match,
			};
		}),
	);
}

function clear(): void {
	for (const field of props.fields) {
		drafts[field.key].value = "";
		drafts[field.key].text = "";
	}
	commit();
}

onMounted(() => {
	void nextTick(() => {
		const input = root.value?.querySelector<HTMLInputElement>("input");
		(input ?? root.value)?.focus();
	});
	for (const field of props.fields) {
		const control = field.control;
		if (control.kind === "remote" && !control.initialOptions?.length) void searchRemote(field, "");
	}
});

onBeforeUnmount(() => {
	disposed = true;
	for (const timer of timers.values()) clearTimeout(timer);
	timers.clear();
});
</script>

<template>
	<form ref="root" class="ui-filter-panel" role="group" :aria-label="label + ' filters'" tabindex="-1" @submit.prevent="commit">
		<div v-for="field in fields" :key="field.key" class="ui-filter-field">
			<span class="ui-filter-field__label">{{ field.label }}</span>
			<template v-if="field.control.kind === 'text'">
				<input
					class="ui-filter-field__input"
					type="search"
					autocomplete="off"
					:value="drafts[field.key].value"
					:placeholder="field.control.placeholder ?? 'Filter value'"
					:aria-label="field.label"
					@input="onTextInput(field, $event)"
					@keydown.enter.prevent="commit"
				/>
				<div class="ui-filter-match" role="group" :aria-label="field.label + ' match mode'">
					<button
						type="button"
						:class="{ 'is-active': drafts[field.key].match === 'fuzzy' }"
						:aria-pressed="drafts[field.key].match === 'fuzzy'"
						@click="drafts[field.key].match = 'fuzzy'"
					>
						Contains
					</button>
					<button
						type="button"
						:class="{ 'is-active': drafts[field.key].match === 'exact' }"
						:aria-pressed="drafts[field.key].match === 'exact'"
						@click="drafts[field.key].match = 'exact'"
					>
						Equals
					</button>
				</div>
			</template>
			<template v-else>
				<input
					v-if="showSearchInput(field)"
					class="ui-filter-field__input"
					type="search"
					autocomplete="off"
					:value="queries[field.key]"
					:placeholder="field.control.kind === 'remote' ? (field.control.placeholder ?? 'Search…') : 'Search options…'"
					:aria-label="field.label + ' search'"
					@input="onQueryInput(field, $event)"
					@keydown.enter.prevent="commit"
				/>
				<div class="ui-filter-options" role="listbox" :aria-label="field.label + ' options'">
					<div v-if="loading[field.key]" class="ui-filter-options__state">Searching…</div>
					<button
						v-for="choice in visibleChoices(field)"
						:key="choice.value"
						type="button"
						role="option"
						class="ui-filter-option"
						:class="{ 'is-selected': drafts[field.key].value === choice.value }"
						:aria-selected="drafts[field.key].value === choice.value"
						@click="choose(field, choice)"
					>
						<span class="ui-filter-option__main">
							<span class="ui-filter-option__label">{{ choice.label }}</span>
							<span v-if="choice.description" class="ui-filter-option__description">{{ choice.description }}</span>
						</span>
						<span v-if="drafts[field.key].value === choice.value" class="ui-filter-option__check" aria-hidden="true">✓</span>
					</button>
					<button
						v-if="canCreate(field)"
						type="button"
						class="ui-filter-option ui-filter-option--create"
						@click="useCustom(field)"
					>
						Use “{{ queries[field.key].trim() }}”
					</button>
					<div v-if="!loading[field.key] && !visibleChoices(field).length && !canCreate(field)" class="ui-filter-options__state">
						No matches
					</div>
				</div>
			</template>
		</div>
		<div class="ui-filter-panel__actions">
			<button type="button" class="ui-filter-panel__clear" :disabled="!active.length && !hasFilters" @click="clear">Clear</button>
			<button type="submit" class="ui-filter-panel__apply">Apply</button>
		</div>
	</form>
</template>
