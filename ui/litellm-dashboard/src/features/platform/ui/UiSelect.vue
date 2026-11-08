<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useAttrs, watch, type StyleValue } from "vue";
import type { UiAppearance, UiControlSize, UiSelectOption, UiValue } from "./UiTypes";
import { nextUiIdentity } from "./UiIdentity";
import UiIcon from "./UiIcon.vue";
import { useSelectTagOverflow } from "./UiSelectTagOverflow";

defineOptions({ inheritAttrs: false });
const props = withDefaults(
	defineProps<{
		modelValue?: UiValue | UiValue[] | null;
		options: readonly UiSelectOption[];
		placeholder?: string;
		emptyText?: string;
		multiple?: boolean;
		maxTagCount?: number | "responsive";
		searchable?: boolean;
		filterable?: boolean;
		creatable?: boolean;
		tokenSeparators?: readonly string[];
		clearable?: boolean;
		disabled?: boolean;
		loading?: boolean;
		size?: UiControlSize;
		appearance?: UiAppearance;
		status?: "error" | "warning";
	}>(),
	{
		emptyText: "No data",
		maxTagCount: undefined,
		tokenSeparators: undefined,
		filterable: true,
		status: undefined,
		modelValue: null,
		placeholder: "Please select",
		size: "middle",
		appearance: "antd",
	},
);
const emit = defineEmits<{
	"update:modelValue": [value: UiValue | UiValue[] | null];
	change: [value: UiValue | UiValue[] | null];
	search: [value: string];
	openChange: [open: boolean];
	popupScroll: [event: Event];
}>();
const attrs = useAttrs();
const root = ref<HTMLElement>();
const popup = ref<HTMLElement>();
const input = ref<HTMLInputElement>();
const values = ref<HTMLElement>();
const measurements = ref<HTMLElement>();
const open = ref(false);
const popupTarget = ref<HTMLElement | string>("body");
const query = ref("");
const activeIndex = ref(0);
const popupStyle = ref<Record<string, string>>({});
const selectedValues = computed<UiValue[]>(() =>
	Array.isArray(props.modelValue) ? props.modelValue : props.modelValue == null ? [] : [props.modelValue],
);
const selectedOptions = computed(() =>
	selectedValues.value.map((value) => props.options.find((option) => option.value === value) ?? { value, label: String(value) }),
);
const responsiveTags = computed(() => props.multiple && props.maxTagCount === "responsive");
const limitedTags = computed(() => props.multiple && props.maxTagCount !== undefined);
const { visibleCount, searchWidth, tagMaxWidth } = useSelectTagOverflow({
	enabled: () => responsiveTags.value,
	revision: () => [selectedOptions.value.map(({ value, label, disabled }) => [value, label, disabled]), query.value, props.disabled],
	container: values,
	measurements,
	onResize: () => {
		if (open.value) positionPopup();
	},
});
const shownOptions = computed(() => {
	const count = typeof props.maxTagCount === "number" ? Math.max(0, Math.floor(props.maxTagCount)) : visibleCount.value;
	return props.maxTagCount === undefined ? selectedOptions.value : selectedOptions.value.slice(0, count);
});
const omittedOptions = computed(() => selectedOptions.value.slice(shownOptions.value.length));
const matchedOptions = computed(() =>
	props.filterable
		? props.options.filter((option) => option.label.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()))
		: props.options,
);
const canCreate = computed(
	() => props.creatable && query.value.trim() && !props.options.some((option) => String(option.value) === query.value.trim()),
);
const filteredOptions = computed(() =>
	canCreate.value ? [{ value: query.value.trim(), label: query.value.trim() }, ...matchedOptions.value] : matchedOptions.value,
);
const controlAttrs = computed(() => ({ ...attrs, class: undefined, style: undefined }));
const rootStyle = computed(() => attrs.style as StyleValue);
const identity = nextUiIdentity("ui-select");

function commit(value: UiValue | UiValue[] | null) {
	emit("update:modelValue", value);
	emit("change", value);
}
function choose(option: UiSelectOption) {
	if (option.disabled || props.disabled) return;
	if (props.multiple) {
		commit(
			selectedValues.value.includes(option.value)
				? selectedValues.value.filter((value) => value !== option.value)
				: [...selectedValues.value, option.value],
		);
		query.value = "";
	} else {
		commit(option.value);
		open.value = false;
		query.value = "";
	}
	void nextTick(() => input.value?.focus());
}
function remove(value: UiValue) {
	if (props.disabled || selectedOptions.value.find((option) => option.value === value)?.disabled) return;
	commit(selectedValues.value.filter((selected) => selected !== value));
}
function clear() {
	commit(props.multiple ? [] : null);
	query.value = "";
	input.value?.focus();
}
function positionPopup() {
	const bounds = root.value?.getBoundingClientRect();
	if (!bounds) return;
	const availableBelow = window.innerHeight - bounds.bottom - 8;
	const desired = Math.min(256, filteredOptions.value.length * 32 + 8);
	const above = availableBelow < desired && bounds.top > availableBelow;
	popupStyle.value = {
		left: Math.max(4, Math.min(bounds.left, window.innerWidth - bounds.width - 4)) + "px",
		width: bounds.width + "px",
		maxHeight: Math.max(80, above ? bounds.top - 8 : availableBelow) + "px",
		...(above ? { bottom: window.innerHeight - bounds.top + 4 + "px" } : { top: bounds.bottom + 4 + "px" }),
	};
}
function outsidePointer(event: PointerEvent) {
	if (!(event.target instanceof Node)) return;
	if (!root.value?.contains(event.target) && !popup.value?.contains(event.target)) open.value = false;
}
function show() {
	if (!props.disabled) {
		popupTarget.value = root.value?.closest("dialog") ?? document.body;
		open.value = true;
	}
}
function search(event: Event) {
	query.value = (event.target as HTMLInputElement).value;
	if (props.multiple && props.creatable && props.tokenSeparators?.length) {
		const parts = props.tokenSeparators.reduce((values, separator) => values.flatMap((value) => value.split(separator)), [query.value]);
		if (parts.length > 1) {
			query.value = parts.pop() || "";
			commit([...new Set([...selectedValues.value, ...parts.map((value) => value.trim()).filter(Boolean)])]);
		}
	}
	activeIndex.value = filteredOptions.value.findIndex((option) => !option.disabled);
	show();
	emit("search", query.value);
	positionPopup();
}
function move(direction: number) {
	const options = filteredOptions.value;
	if (!options.length) return;
	for (let offset = 1; offset <= options.length; offset++) {
		const next = (activeIndex.value + direction * offset + options.length) % options.length;
		if (!options[next]?.disabled) {
			activeIndex.value = next;
			break;
		}
	}
	void nextTick(() => popup.value?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" }));
}
function keydown(event: KeyboardEvent) {
	if (props.disabled) return;
	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		if (!open.value) show();
		else move(event.key === "ArrowDown" ? 1 : -1);
	} else if (event.key === "Enter") {
		event.preventDefault();
		if (!open.value) show();
		else if (canCreate.value) choose({ value: query.value.trim(), label: query.value.trim() });
		else if (filteredOptions.value[activeIndex.value]) choose(filteredOptions.value[activeIndex.value]);
	} else if (event.key === "Escape") {
		if (open.value) {
			event.preventDefault();
			event.stopPropagation();
		}
		open.value = false;
	} else if (event.key === "Tab") open.value = false;
	else if (event.key === "Backspace" && props.multiple && !query.value && !event.isComposing) {
		const last = [...selectedOptions.value].reverse().find((option) => !option.disabled);
		if (last) {
			event.preventDefault();
			remove(last.value);
		}
	}
}
watch(open, (value) => {
	emit("openChange", value);
	if (!value) query.value = "";
	if (value) {
		const selected = filteredOptions.value.findIndex((option) => !option.disabled && selectedValues.value.includes(option.value));
		activeIndex.value = selected >= 0 ? selected : filteredOptions.value.findIndex((option) => !option.disabled);
		positionPopup();
		document.addEventListener("pointerdown", outsidePointer);
		window.addEventListener("resize", positionPopup);
		window.addEventListener("scroll", positionPopup, true);
	} else {
		document.removeEventListener("pointerdown", outsidePointer);
		window.removeEventListener("resize", positionPopup);
		window.removeEventListener("scroll", positionPopup, true);
	}
});
watch(
	() => props.disabled,
	(disabled) => {
		if (disabled) open.value = false;
	},
);
onBeforeUnmount(() => {
	document.removeEventListener("pointerdown", outsidePointer);
	window.removeEventListener("resize", positionPopup);
	window.removeEventListener("scroll", positionPopup, true);
});
defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
	<div
		ref="root"
		class="ui-select"
		:class="[
			'ui-select--' + appearance,
			'ui-select--' + size,
			attrs.class,
			{
				'ui-select--open': open,
				'ui-select--disabled': disabled,
				'ui-select--multiple': multiple,
				'ui-select--empty': selectedOptions.length === 0,
				'ui-select--tag-limited': limitedTags,
				'ui-select--tag-responsive': responsiveTags,
				'ui-select--error': status === 'error',
				'ui-select--warning': status === 'warning',
			},
		]"
		:style="rootStyle"
		@click="show"
	>
		<div
			ref="values"
			class="ui-select__values"
			:style="responsiveTags && tagMaxWidth !== undefined ? { '--ui-select-tag-max-width': tagMaxWidth + 'px' } : undefined"
		>
			<template v-if="multiple">
				<span v-for="option in shownOptions" :key="option.value" class="ui-select__tag" :title="option.label">
					<span>{{ option.label }}</span>
					<button
						v-if="(!disabled && !option.disabled) || (appearance !== 'antd' && !limitedTags)"
						type="button"
						:disabled="disabled || option.disabled"
						:aria-label="'Remove ' + option.label"
						@mousedown.prevent
						@click.stop="remove(option.value)"
					>
						<UiIcon v-if="limitedTags || appearance === 'antd'" name="CloseOutlined" :size="10" /><svg
							v-else-if="appearance === 'tremor'"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<line x1="18" y1="6" x2="6" y2="18" />
							<line x1="6" y1="6" x2="18" y2="18" /></svg
						><template v-else>×</template>
					</button>
				</span>
				<span
					v-if="omittedOptions.length"
					class="ui-select__tag ui-select__tag--overflow"
					:title="omittedOptions.map((option) => option.label).join(', ')"
				>
					<span
						><slot name="overflow" :options="omittedOptions" :count="omittedOptions.length"
							>+ {{ omittedOptions.length }} ...</slot
						></span
					>
				</span>
			</template>
			<span v-else-if="selectedOptions.length && !query" class="ui-select__single"
				><slot name="value" :option="selectedOptions[0]"
					><slot name="selected" :option="selectedOptions[0]">{{ selectedOptions[0].label }}</slot></slot
				></span
			>
			<span
				v-if="multiple && appearance === 'antd' && !selectedOptions.length && !query"
				class="ui-select__placeholder"
				aria-hidden="true"
				>{{ placeholder }}</span
			>
			<input
				ref="input"
				v-bind="controlAttrs"
				role="combobox"
				:type="appearance === 'antd' ? 'search' : 'text'"
				class="ui-select__input"
				:value="query"
				:style="responsiveTags ? { width: searchWidth + 'px' } : undefined"
				:placeholder="selectedOptions.length ? '' : placeholder"
				:readonly="!searchable"
				:disabled="disabled"
				:aria-expanded="open"
				aria-autocomplete="list"
				:aria-controls="identity"
				:aria-activedescendant="open && activeIndex >= 0 ? identity + '-' + activeIndex : undefined"
				@input="search"
				@keydown="keydown"
			/>
			<div v-if="responsiveTags" ref="measurements" class="ui-select__measurements" aria-hidden="true" inert>
				<span v-for="option in selectedOptions" :key="option.value" class="ui-select__tag" data-select-tag-measure>
					<span>{{ option.label }}</span
					><span v-if="!disabled && !option.disabled" class="ui-select__tag-remove-measure"
						><UiIcon name="CloseOutlined" :size="10"
					/></span>
				</span>
				<span
					v-for="count in selectedOptions.length"
					:key="'rest-' + count"
					class="ui-select__tag ui-select__tag--overflow"
					data-select-rest-measure
				>
					<span
						><slot name="overflow" :options="$slots.overflow ? selectedOptions.slice(-count) : []" :count="count"
							>+ {{ count }} ...</slot
						></span
					>
				</span>
				<span class="ui-select__search-measure" data-select-search-measure>{{ query }}&nbsp;</span>
			</div>
		</div>
		<button
			v-if="clearable && selectedOptions.length && !disabled"
			type="button"
			class="ui-select__clear"
			aria-label="Clear selection"
			@click.stop="clear"
		>
			<UiIcon v-if="appearance === 'antd'" name="CloseCircleFilled" :size="12" /><svg
				v-else-if="appearance === 'tremor'"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="currentColor"
				aria-hidden="true"
			>
				<path
					d="M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 10.5858L9.17157 7.75736L7.75736 9.17157L10.5858 12L7.75736 14.8284L9.17157 16.2426L12 13.4142L14.8284 16.2426L16.2426 14.8284L13.4142 12L16.2426 9.17157L14.8284 7.75736L12 10.5858Z"
				/></svg
			><template v-else>×</template>
		</button>
		<span class="ui-select__arrow" aria-hidden="true">
			<slot name="suffix">
				<UiIcon v-if="appearance === 'antd'" name="DownOutlined" :size="12" />
				<svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
					<path
						d="M11.9999 13.1714L16.9497 8.22168L18.3639 9.63589L11.9999 15.9999L5.63599 9.63589L7.0502 8.22168L11.9999 13.1714Z"
					/>
				</svg>
			</slot>
		</span>
	</div>
	<Teleport :to="popupTarget">
		<div
			v-if="open"
			:id="identity"
			ref="popup"
			class="ui-select-popup"
			:class="'ui-select-popup--' + appearance"
			:style="popupStyle"
			role="listbox"
			:aria-multiselectable="multiple || undefined"
			@scroll="emit('popupScroll', $event)"
		>
			<div v-if="loading" class="ui-select-popup__empty">Loading...</div>
			<div v-else-if="!filteredOptions.length" class="ui-select-popup__empty">{{ emptyText }}</div>
			<template v-for="(option, index) in filteredOptions" :key="option.value">
				<div
					v-if="option.group && (index === 0 || filteredOptions[index - 1].group !== option.group)"
					class="ui-select-popup__group"
				>
					{{ option.group }}
				</div>
				<button
					:id="identity + '-' + index"
					type="button"
					role="option"
					class="ui-select-popup__option"
					:class="{
						'ui-select-popup__option--active': index === activeIndex,
						'ui-select-popup__option--selected': selectedValues.includes(option.value),
					}"
					:data-active="index === activeIndex"
					:aria-selected="selectedValues.includes(option.value)"
					:disabled="option.disabled"
					@mouseenter="activeIndex = index"
					@mousedown.prevent
					@click="choose(option)"
				>
					<span
						><slot name="option" :option="option"
							>{{ option.label }}<small v-if="option.description">{{ option.description }}</small></slot
						></span
					>
					<span v-if="selectedValues.includes(option.value)" class="ui-select-popup__check" aria-hidden="true">✓</span>
				</button>
			</template>
			<slot name="footer" />
		</div>
	</Teleport>
</template>
