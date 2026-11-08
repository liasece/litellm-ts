<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { nextUiIdentity } from "../../platform/ui/UiIdentity";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { relativeDateOptions, type DateRangeValue } from "../support/DateRangeModels";
import { displayDateRange, displaySelectionDate } from "../logic/DateRangeLogic";
import { createDateRangeStore } from "../stores/DateRangeStore";
import "../styles/AdvancedDatePickerStyles.css";
const props = withDefaults(
	defineProps<{
		value?: DateRangeValue;
		modelValue?: DateRangeValue;
		label?: string;
		className?: string;
		showTimeRange?: boolean;
		showQuickSelect?: boolean;
	}>(),
	{
		value: undefined,
		modelValue: undefined,
		label: "Select Time Range",
		className: undefined,
		showTimeRange: true,
		showQuickSelect: false,
	},
);
const emit = defineEmits<{
	valueChange: [value: DateRangeValue];
	"update:modelValue": [value: DateRangeValue];
	change: [value: DateRangeValue];
}>();
const startIdentity = nextUiIdentity("date-range-start"),
	endIdentity = nextUiIdentity("date-range-end");
const external = computed(() => props.modelValue ?? props.value ?? {}),
	store = createDateRangeStore(external.value, (value) => {
		emit("valueChange", value);
		emit("update:modelValue", value);
		emit("change", value);
	}),
	{ state, validation } = store,
	root = ref<HTMLDivElement>();
watch(external, (value) => store.setValue(value), { deep: true });
function outside(event: MouseEvent) {
	if (state.open && root.value && !root.value.contains(event.target as Node)) state.open = false;
}
onMounted(() => document.addEventListener("mousedown", outside));
onBeforeUnmount(() => {
	document.removeEventListener("mousedown", outside);
	store.dispose();
});
</script>
<template>
	<div class="date-range-picker">
		<label v-if="label">{{ label }}</label>
		<div v-if="showQuickSelect" class="date-range-quick" aria-label="Quick time range">
			<button
				v-for="option in relativeDateOptions.slice(0, 3)"
				:key="option.shortLabel"
				type="button"
				:aria-pressed="state.selected === option.shortLabel"
				:class="{ selected: state.selected === option.shortLabel }"
				@click="store.quick(option)"
			>
				{{ option.label }}
			</button>
		</div>
		<div ref="root" class="date-range-dropdown">
			<button type="button" class="date-range-trigger" :aria-expanded="state.open" @click="state.open = !state.open">
				<span class="date-range-trigger-content">
					<span class="date-range-trigger-main"
						><span class="date-range-clock"><UiIcon name="ClockCircleOutlined" /></span
						><span>{{ displayDateRange(external) }}</span></span
					>
					<svg viewBox="0 0 24 24" :class="{ open: state.open }" fill="none" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
					</svg>
				</span>
			</button>
			<div v-if="state.open" class="date-range-popup">
				<div class="date-range-relative">
					<header>Relative time</header>
					<div>
						<button
							v-for="option in relativeDateOptions"
							:key="option.shortLabel"
							type="button"
							:class="{ selected: state.selected === option.shortLabel }"
							@click="store.select(option)"
						>
							<span>{{ option.label }}</span
							><small>{{ option.shortLabel }}</small>
						</button>
					</div>
				</div>
				<div class="date-range-custom">
					<header><UiIcon name="CalendarOutlined" />Start and end dates</header>
					<div class="date-range-fields">
						<div>
							<label :for="startIdentity">Start date</label
							><input :id="startIdentity" v-model="state.start" type="date" :class="{ invalid: !validation.isValid }" />
						</div>
						<div>
							<label :for="endIdentity">End date</label
							><input :id="endIdentity" v-model="state.end" type="date" :class="{ invalid: !validation.isValid }" />
						</div>
						<div v-if="!validation.isValid && validation.error" class="date-range-error">
							<UiIcon name="WarningOutlined" /><strong>{{ validation.error }}</strong>
						</div>
						<div v-if="state.temp.from && state.temp.to && validation.isValid" class="date-range-selection">
							<p><strong>From:</strong> {{ displaySelectionDate(state.temp.from) }}</p>
							<p><strong>To:</strong> {{ displaySelectionDate(state.temp.to) }}</p>
						</div>
					</div>
					<footer>
						<UiButton appearance="tremor" @click="store.cancel">Cancel</UiButton
						><UiButton
							appearance="tremor"
							variant="primary"
							:disabled="!state.temp.from || !state.temp.to || !validation.isValid"
							@click="store.apply"
							>Apply</UiButton
						>
					</footer>
				</div>
			</div>
		</div>
	</div>
</template>
