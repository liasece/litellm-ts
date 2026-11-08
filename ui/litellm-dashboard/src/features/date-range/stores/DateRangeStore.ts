import { computed, reactive, watch } from "vue";
import {
	adjustDateRange,
	localDateString,
	parseLocalDate,
	relativeDateRange,
	matchingDateOption,
	validateDateInputs,
} from "../logic/DateRangeLogic";
import type { DateRangeValue, RelativeDateOption } from "../support/DateRangeModels";
type Schedule = (callback: () => void) => void;
export function createDateRangeStore(
	initial: DateRangeValue,
	onChange: (value: DateRangeValue) => void,
	options: { now?: () => Date; schedule?: Schedule } = {},
) {
	const now = options.now || (() => new Date()),
		schedule: Schedule =
			options.schedule ||
			((callback) => {
				if (typeof window !== "undefined" && window.requestIdleCallback) window.requestIdleCallback(callback, { timeout: 100 });
				else setTimeout(callback, 0);
			});
	let external = initial,
		disposed = false;
	const state = reactive({
			open: false,
			temp: { ...initial } as DateRangeValue,
			selected: matchingDateOption(initial, now()),
			start: initial.from ? localDateString(initial.from) : "",
			end: initial.to ? localDateString(initial.to) : "",
		}),
		validation = computed(() => validateDateInputs(state.start, state.end));
	function syncInputs() {
		if (state.start && state.end && validation.value.isValid) {
			const from = parseLocalDate(state.start),
				to = parseLocalDate(state.end);
			if (from && to) {
				state.temp = adjustDateRange({ from, to });
				state.selected = matchingDateOption(state.temp, now());
			}
		}
	}
	const stop = watch(() => [state.start, state.end], syncInputs, { immediate: true });
	function setValue(value: DateRangeValue) {
		external = value;
		if (value.from) state.start = localDateString(value.from);
		if (value.to) state.end = localDateString(value.to);
		state.temp = { ...value };
		state.selected = matchingDateOption(value, now());
	}
	function select(option: RelativeDateOption) {
		const range = relativeDateRange(option, now());
		state.temp = range;
		state.selected = option.shortLabel;
		state.start = range.from ? localDateString(range.from) : state.start;
		state.end = range.to ? localDateString(range.to) : state.end;
	}
	function quick(option: RelativeDateOption) {
		select(option);
		state.open = false;
		onChange(adjustDateRange(state.temp));
	}
	function apply() {
		if (!state.temp.from || !state.temp.to || !validation.value.isValid) return false;
		const value = { ...state.temp };
		onChange(value);
		schedule(() => {
			if (!disposed) onChange(adjustDateRange(value));
		});
		state.open = false;
		return true;
	}
	function cancel() {
		state.temp = { ...external };
		if (external.from) state.start = localDateString(external.from);
		if (external.to) state.end = localDateString(external.to);
		state.selected = matchingDateOption(external, now());
		state.open = false;
	}
	return {
		state,
		validation,
		setValue,
		select,
		quick,
		apply,
		cancel,
		dispose() {
			disposed = true;
			stop();
		},
	};
}
