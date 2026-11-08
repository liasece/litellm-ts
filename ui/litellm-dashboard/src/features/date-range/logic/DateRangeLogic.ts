import { relativeDateOptions, type DateRangeValue, type RelativeDateOption } from "../support/DateRangeModels";
const pad = (value: number) => String(value).padStart(2, "0");
export function localDateString(date: Date) {
	return Number.isNaN(date.getTime()) ? "Invalid date" : date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}
export function parseLocalDate(value: string): Date | null {
	const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
	if (!match) return null;
	const year = Number(match[1]),
		month = Number(match[2]) - 1,
		day = Number(match[3]),
		date = new Date(year, month, day);
	if (year >= 0 && year < 100) date.setFullYear(year);
	return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}
export function adjustDateRange(value: DateRangeValue): DateRangeValue {
	if (!value.from) return value;
	const from = new Date(value.from),
		to = new Date(value.to || value.from);
	from.setHours(0, 0, 0, 0);
	to.setHours(23, 59, 59, 999);
	return { ...value, from, to };
}
export function relativeDateRange(option: RelativeDateOption, now = new Date()): DateRangeValue {
	const from = new Date(now),
		to = new Date(now);
	if (option.start === "month") from.setDate(1);
	else if (option.start === "year") from.setMonth(0, 1);
	else from.setDate(from.getDate() - (option.days || 0));
	return adjustDateRange({ from, to });
}
export function matchingDateOption(value: DateRangeValue, now = new Date()) {
	if (!value.from || !value.to) return null;
	const from = localDateString(value.from),
		to = localDateString(value.to);
	return (
		relativeDateOptions.find((option) => {
			const range = relativeDateRange(option, now);
			return range.from && range.to && localDateString(range.from) === from && localDateString(range.to) === to;
		})?.shortLabel || null
	);
}
export function validateDateInputs(start: string, end: string) {
	if (!start || !end) return { isValid: true, error: "" };
	const from = parseLocalDate(start),
		to = parseLocalDate(end);
	if (!from || !to) return { isValid: false, error: "Invalid date format" };
	if (to < from) return { isValid: false, error: "End date cannot be before start date" };
	return { isValid: true, error: "" };
}
function month(date: Date) {
	return date.toLocaleString("en-US", { month: "short" });
}
export function displayDateRange(value: DateRangeValue) {
	if (!value.from || !value.to) return "Select date range";
	const text = (date: Date) =>
		Number.isNaN(date.getTime())
			? "Invalid date"
			: date.getDate() + " " + month(date) + ", " + pad(date.getHours()) + ":" + pad(date.getMinutes());
	return text(value.from) + " - " + text(value.to);
}
export function displaySelectionDate(date: Date) {
	if (Number.isNaN(date.getTime())) return "Invalid date";
	return (
		month(date) +
		" " +
		date.getDate() +
		", " +
		date.getFullYear() +
		" at " +
		pad(date.getHours()) +
		":" +
		pad(date.getMinutes()) +
		":" +
		pad(date.getSeconds())
	);
}
