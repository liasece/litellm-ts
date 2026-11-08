import { describe, it, expect, vi } from "vitest";
import { nextTick } from "vue";
import { createDateRangeStore } from "./DateRangeStore";
import { relativeDateOptions } from "../support/DateRangeModels";
import { relativeDateRange, matchingDateOption, adjustDateRange, displayDateRange, validateDateInputs } from "../logic/DateRangeLogic";
const now = () => new Date(2026, 10, 7, 12, 30, 45);
describe("Shared advanced date range compatibility", () => {
	it("preserves calendar-day presets, including the original 31-day inclusive Last 30 days", () => {
		const range = relativeDateRange(relativeDateOptions[3], now());
		expect(range.from).toEqual(new Date(2026, 9, 8, 0, 0, 0, 0));
		expect(range.to).toEqual(new Date(2026, 10, 7, 23, 59, 59, 999));
		expect(matchingDateOption(range, now())).toBe("30d");
		expect(relativeDateRange(relativeDateOptions[2], now()).from).toEqual(new Date(2026, 10, 1));
	});
	it("normalizes a single selected day without mutating the caller dates or extension fields", () => {
		const from = now(),
			value = { from, selectValue: "custom" },
			adjusted = adjustDateRange(value);
		expect(from.getHours()).toBe(12);
		expect(adjusted.selectValue).toBe("custom");
		expect(adjusted.from?.getHours()).toBe(0);
		expect(adjusted.to?.getHours()).toBe(23);
		expect(adjusted.to?.getMilliseconds()).toBe(999);
	});
	it("holds relative selections locally until Apply then emits both immediate and idle-normalized values", () => {
		const changed = vi.fn(),
			scheduled: (() => void)[] = [],
			store = createDateRangeStore({}, changed, { now, schedule: (callback) => scheduled.push(callback) });
		store.select(relativeDateOptions[1]);
		expect(changed).not.toHaveBeenCalled();
		expect(store.apply()).toBe(true);
		expect(changed).toHaveBeenCalledTimes(1);
		expect(store.state.open).toBe(false);
		scheduled[0]();
		expect(changed).toHaveBeenCalledTimes(2);
		expect(changed.mock.calls[1][0].to.getMilliseconds()).toBe(999);
		store.dispose();
	});
	it("quick selections apply immediately once and Cancel restores external range without a callback", async () => {
		const changed = vi.fn(),
			initial = { from: new Date(2026, 10, 1), to: new Date(2026, 10, 7) },
			store = createDateRangeStore(initial, changed, { now });
		store.state.open = true;
		store.select(relativeDateOptions[0]);
		store.cancel();
		await nextTick();
		expect(changed).not.toHaveBeenCalled();
		expect(store.state.start).toBe("2026-11-01");
		store.quick(relativeDateOptions[0]);
		expect(changed).toHaveBeenCalledOnce();
		expect(changed.mock.calls[0][0].from).toEqual(new Date(2026, 10, 7));
		expect(store.state.open).toBe(false);
		store.dispose();
	});
	it("blocks reversed or invalid ranges and updates a corrected custom range before submission", async () => {
		const changed = vi.fn(),
			store = createDateRangeStore({}, changed, { now });
		store.state.start = "2026-11-07";
		store.state.end = "2026-11-01";
		await nextTick();
		expect(store.validation.value).toEqual({ isValid: false, error: "End date cannot be before start date" });
		expect(store.apply()).toBe(false);
		store.state.end = "2026-11-08";
		await nextTick();
		expect(store.validation.value.isValid).toBe(true);
		expect(store.state.temp.to).toEqual(new Date(2026, 10, 8, 23, 59, 59, 999));
		expect(validateDateInputs("2026-02-31", "2026-03-01").isValid).toBe(false);
		store.dispose();
	});
	it("keeps time in the trigger and cancels scheduled callbacks after owner disposal", () => {
		expect(displayDateRange({ from: now(), to: now() })).toBe("7 Nov, 12:30 - 7 Nov, 12:30");
		const changed = vi.fn(),
			scheduled: (() => void)[] = [],
			store = createDateRangeStore({ from: now(), to: now() }, changed, { now, schedule: (callback) => scheduled.push(callback) });
		store.apply();
		store.dispose();
		scheduled[0]();
		expect(changed).toHaveBeenCalledOnce();
	});
});
