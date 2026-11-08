<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import type { DateRangeValue } from "../support/DateRangeModels";
import { adjustDateRange } from "../logic/DateRangeLogic";
import {
	calendarDays,
	dateKey,
	defaultTremorRanges,
	displayTremorRange,
	nextRange,
	shiftDate,
	startDate,
	usageTimeRange,
} from "../logic/TremorDateRangeLogic";
import "../styles/TremorDateRangePickerStyles.css";
const props = withDefaults(
	defineProps<{ modelValue?: DateRangeValue; value?: DateRangeValue; label?: string; showTimeRange?: boolean }>(),
	{ modelValue: undefined, value: undefined, label: "Select Time Range", showTimeRange: true },
);
const emit = defineEmits<{
	"update:modelValue": [value: DateRangeValue];
	valueChange: [value: DateRangeValue];
	change: [value: DateRangeValue];
}>();
const external = computed(() => props.modelValue ?? props.value ?? {}),
	root = ref<HTMLElement>(),
	trigger = ref<HTMLButtonElement>(),
	open = ref(false),
	feedback = ref(false),
	month = ref(startDate(external.value.to || external.value.from || new Date()));
const options = defaultTremorRanges(),
	calendar = ref<HTMLElement>(),
	selectedDay = ref(dateKey(external.value.from || new Date()));
let feedbackTimer: ReturnType<typeof setTimeout> | undefined,
	disposed = false;
const weeks = computed(() => calendarDays(month.value));
const selected = computed(() => ({
	from: external.value.from ? dateKey(external.value.from) : "",
	to: external.value.to ? dateKey(external.value.to) : "",
}));
watch(open, (value) => {
	if (value) month.value = startDate(external.value.to || external.value.from || new Date());
});
function publish(value: DateRangeValue) {
	emit("update:modelValue", value);
	emit("valueChange", value);
	emit("change", value);
}
function change(value: DateRangeValue) {
	feedback.value = true;
	if (feedbackTimer) clearTimeout(feedbackTimer);
	feedbackTimer = setTimeout(() => (feedback.value = false), 1500);
	publish(value);
	const adjust = () => {
		if (!disposed && value.from) publish(adjustDateRange({ ...value, to: value.to || value.from }));
	};
	if (window.requestIdleCallback) window.requestIdleCallback(adjust, { timeout: 100 });
	else setTimeout(adjust, 0);
}
function relative(value: unknown) {
	const option = options.find((option) => option.value === value);
	if (option) change({ from: option.from, to: option.to, selectValue: option.value });
}
function choose(day: Date) {
	selectedDay.value = dateKey(day);
	change(nextRange(external.value, startDate(day)));
}
function moveMonth(direction: number) {
	month.value = new Date(month.value.getFullYear(), month.value.getMonth() + direction, 1);
}
function outside(event: MouseEvent) {
	if (root.value && !root.value.contains(event.target as Node)) open.value = false;
}
async function keydown(event: KeyboardEvent, day: Date) {
	if (event.key === "Escape") {
		open.value = false;
		trigger.value?.focus();
		return;
	}
	const delta =
		event.key === "ArrowRight"
			? 1
			: event.key === "ArrowLeft"
				? -1
				: event.key === "ArrowDown"
					? 7
					: event.key === "ArrowUp"
						? -7
						: event.key === "Home"
							? -day.getDay()
							: event.key === "End"
								? 6 - day.getDay()
								: null;
	if (delta === null) return;
	event.preventDefault();
	const next = shiftDate(day, delta);
	selectedDay.value = dateKey(next);
	month.value = new Date(next.getFullYear(), next.getMonth(), 1);
	await nextTick();
	calendar.value?.querySelector<HTMLButtonElement>('[data-date="' + dateKey(next) + '"]')?.focus();
}
onMounted(() => document.addEventListener("mousedown", outside));
onBeforeUnmount(() => {
	disposed = true;
	document.removeEventListener("mousedown", outside);
	if (feedbackTimer) clearTimeout(feedbackTimer);
});
</script>
<template>
	<div ref="root" class="tremor-date-range">
		<p v-if="label" class="tremor-date-range-label">{{ label }}</p>
		<div class="tremor-date-range-row">
			<div class="tremor-date-range-controls">
				<div class="tremor-date-range-trigger-wrap">
					<button
						ref="trigger"
						type="button"
						class="tremor-date-range-trigger"
						:aria-expanded="open"
						aria-label="Select date range"
						@click="open = !open"
						@keydown.esc="open = false"
					>
						<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true">
							<path
								fill-rule="evenodd"
								clip-rule="evenodd"
								d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z"
							/></svg
						><span>{{ displayTremorRange(external) }}</span>
					</button>
				</div>
				<div class="tremor-date-range-select-wrap">
					<UiSelect
						:model-value="external.selectValue || null"
						:options="options.map((option) => ({ label: option.label, value: option.value }))"
						appearance="tremor"
						placeholder="Select range"
						class="tremor-date-relative-select"
						aria-label="Select relative date range"
						@update:model-value="relative"
					/>
				</div>
			</div>
			<span v-if="feedback" class="tremor-date-selected"><i>✓</i>Selected</span>
			<div v-if="open" ref="calendar" class="tremor-date-calendar" role="dialog" aria-label="Choose date range">
				<header>
					<button type="button" aria-label="Go to previous month" @click="moveMonth(-1)">
						<svg viewBox="0 0 24 24" fill="currentColor">
							<path
								d="M10.8284 12.0007L15.7782 16.9504L14.364 18.3646L8 12.0007L14.364 5.63672L15.7782 7.05093L10.8284 12.0007Z"
							/>
						</svg></button
					><span>{{ month.toLocaleDateString("en-US", { month: "long", year: "numeric" }) }}</span
					><button type="button" aria-label="Go to next month" @click="moveMonth(1)">
						<svg viewBox="0 0 24 24" fill="currentColor">
							<path
								d="M13.1717 12.0007L8.22192 7.05093L9.63614 5.63672L16.0001 12.0007L9.63614 18.3646L8.22192 16.9504L13.1717 12.0007Z"
							/>
						</svg>
					</button>
				</header>
				<table role="grid">
					<thead>
						<tr>
							<th v-for="name in ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']" :key="name">{{ name }}</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="(week, index) in weeks" :key="index">
							<td v-for="day in week" :key="dateKey(day)">
								<button
									type="button"
									:data-date="dateKey(day)"
									:aria-label="
										day.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
									"
									:aria-selected="
										Boolean(
											selected.from &&
												dateKey(day) >= selected.from &&
												(selected.to ? dateKey(day) <= selected.to : dateKey(day) === selected.from),
										)
									"
									:tabindex="dateKey(day) === selectedDay ? 0 : -1"
									:class="{
										'outside': day.getMonth() !== month.getMonth(),
										'today': dateKey(day) === dateKey(new Date()),
										'selected-start': dateKey(day) === selected.from,
										'selected-end': dateKey(day) === selected.to,
										'selected-between': Boolean(
											selected.from && selected.to && dateKey(day) > selected.from && dateKey(day) < selected.to,
										),
									}"
									@click="choose(day)"
									@keydown="keydown($event, day)"
								>
									{{ day.getDate() }}
								</button>
							</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
		<p v-if="showTimeRange && external.from && external.to" class="tremor-date-time">
			{{ usageTimeRange(external.from, external.to) }}
		</p>
	</div>
</template>
