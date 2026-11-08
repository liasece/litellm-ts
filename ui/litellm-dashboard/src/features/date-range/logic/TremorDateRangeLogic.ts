import type { DateRangeValue } from "../support/DateRangeModels";
export function startDate(value: Date): Date {
	const date = new Date(value);
	date.setHours(0, 0, 0, 0);
	return date;
}
export function shiftDate(value: Date, days: number): Date {
	const date = new Date(value);
	date.setDate(date.getDate() + days);
	return date;
}
export function dateKey(value: Date): string {
	return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}
export function defaultTremorRanges(now = new Date()) {
	const today = startDate(now);
	return [
		{ value: "tdy", label: "Today", from: today, to: today },
		{ value: "w", label: "Last 7 days", from: shiftDate(today, -7), to: today },
		{ value: "t", label: "Last 30 days", from: shiftDate(today, -30), to: today },
		{ value: "m", label: "Month to Date", from: new Date(today.getFullYear(), today.getMonth(), 1), to: today },
		{ value: "y", label: "Year to Date", from: new Date(today.getFullYear(), 0, 1), to: today },
	];
}
export function displayTremorRange(value: DateRangeValue): string {
	const from = value.from ? startDate(value.from) : undefined,
		to = value.to ? startDate(value.to) : undefined;
	if (!from && !to) return "Select date range";
	if (from && !to) return from.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
	if (from && to) {
		if (dateKey(from) === dateKey(to)) return from.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
		if (from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear())
			return from.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " - " + to.getDate() + ", " + to.getFullYear();
		return (
			from.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) +
			" - " +
			to.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
		);
	}
	return "";
}
export function usageTimeRange(from?: Date, to?: Date): string {
	if (!from || !to) return "";
	if (from.toDateString() === to.toDateString())
		return (
			from.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
			": " +
			from.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }) +
			" - " +
			to.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZoneName: "short" })
		);
	const format = (value: Date) =>
		value.toLocaleString("en-US", {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			hour12: true,
			timeZoneName: "short",
		});
	return format(from) + " - " + format(to);
}
export function calendarDays(month: Date) {
	const first = new Date(month.getFullYear(), month.getMonth(), 1);
	const start = shiftDate(first, -first.getDay());
	const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
	const weeks = Math.ceil((first.getDay() + end.getDate()) / 7);
	return Array.from({ length: weeks }, (_, week) => Array.from({ length: 7 }, (_, day) => shiftDate(start, week * 7 + day)));
}
export function nextRange(value: DateRangeValue, day: Date): DateRangeValue {
	const from = value.from ? startDate(value.from) : undefined,
		to = value.to ? startDate(value.to) : undefined;
	const same = (left: Date, right: Date) => dateKey(left) === dateKey(right);
	if (from && to) {
		if (same(to, day) && same(from, day)) return {};
		if (same(to, day)) return { from: to, to: undefined };
		if (same(from, day)) return {};
		return day < from ? { from: day, to } : { from, to: day };
	}
	if (to) return day > to ? { from: to, to: day } : { from: day, to };
	if (from) return day < from ? { from: day, to: from } : { from, to: day };
	return { from: day, to: undefined };
}
