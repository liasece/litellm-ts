/**
 * Calendar tick intervals follow the original d3-time scaleTime ticks(5).
 * Calendar boundaries use the browser timezone, as did the original scale.
 * See ../support/D3Time.LICENSE.
 */
type Unit = "millisecond" | "second" | "minute" | "hour" | "day" | "week" | "month" | "year";
interface Interval {
	unit: Unit;
	step: number;
	duration: number;
}
const second = 1000,
	minute = 60 * second,
	hour = 60 * minute,
	day = 24 * hour;
const intervals: Interval[] = [
	{ unit: "second", step: 1, duration: second },
	{ unit: "second", step: 5, duration: 5 * second },
	{ unit: "second", step: 15, duration: 15 * second },
	{ unit: "second", step: 30, duration: 30 * second },
	{ unit: "minute", step: 1, duration: minute },
	{ unit: "minute", step: 5, duration: 5 * minute },
	{ unit: "minute", step: 15, duration: 15 * minute },
	{ unit: "minute", step: 30, duration: 30 * minute },
	{ unit: "hour", step: 1, duration: hour },
	{ unit: "hour", step: 3, duration: 3 * hour },
	{ unit: "hour", step: 6, duration: 6 * hour },
	{ unit: "hour", step: 12, duration: 12 * hour },
	{ unit: "day", step: 1, duration: day },
	{ unit: "day", step: 2, duration: 2 * day },
	{ unit: "week", step: 1, duration: 7 * day },
	{ unit: "month", step: 1, duration: 30 * day },
	{ unit: "month", step: 3, duration: 90 * day },
	{ unit: "year", step: 1, duration: 365 * day },
];
function numberStep(value: number): number {
	if (!(value > 0)) return 1;
	const power = Math.floor(Math.log10(value)),
		error = value / 10 ** power;
	const factor = error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.sqrt(2) ? 2 : 1;
	return factor * 10 ** power;
}
function choose(start: number, end: number): Interval {
	const target = Math.abs(end - start) / 5;
	const index = intervals.findIndex((interval) => interval.duration > target);
	if (index === 0) return { unit: "millisecond", step: Math.max(1, numberStep(target)), duration: 1 };
	if (index < 0) return { unit: "year", step: Math.max(1, Math.floor(numberStep(target / (365 * day)))), duration: 365 * day };
	const before = intervals[index - 1]!,
		after = intervals[index]!;
	return target / before.duration < after.duration / target ? before : after;
}
function floor(date: Date, unit: Unit): void {
	if (unit === "year") {
		date.setMonth(0, 1);
		date.setHours(0, 0, 0, 0);
	} else if (unit === "month") {
		date.setDate(1);
		date.setHours(0, 0, 0, 0);
	} else if (unit === "week") {
		date.setDate(date.getDate() - date.getDay());
		date.setHours(0, 0, 0, 0);
	} else if (unit === "day") date.setHours(0, 0, 0, 0);
	else if (unit === "hour") date.setMinutes(0, 0, 0);
	else if (unit === "minute") date.setSeconds(0, 0);
	else if (unit === "second") date.setMilliseconds(0);
}
function field(date: Date, unit: Unit): number {
	if (unit === "year") return date.getFullYear();
	if (unit === "month") return date.getMonth();
	if (unit === "day") return date.getDate() - 1;
	if (unit === "hour") return date.getHours();
	if (unit === "minute") return date.getMinutes();
	if (unit === "second") return date.getSeconds();
	return date.getTime();
}
function advance(date: Date, unit: Unit): void {
	if (unit === "year") date.setFullYear(date.getFullYear() + 1);
	else if (unit === "month") date.setMonth(date.getMonth() + 1);
	else if (unit === "week") date.setDate(date.getDate() + 7);
	else if (unit === "day") date.setDate(date.getDate() + 1);
	else date.setTime(date.getTime() + (unit === "hour" ? hour : unit === "minute" ? minute : unit === "second" ? second : 1));
}
export function speedTimeTicks(start: number, end: number): number[] {
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
	if (start === end) return [start];
	const interval = choose(start, end);
	if (interval.unit === "millisecond") {
		const values: number[] = [];
		for (let value = Math.ceil(start / interval.step) * interval.step; value <= end; value += interval.step) values.push(value);
		return values;
	}
	const date = new Date(start);
	floor(date, interval.unit);
	while (date.getTime() < start || field(date, interval.unit) % interval.step !== 0) advance(date, interval.unit);
	const values: number[] = [];
	for (let guard = 0; date.getTime() <= end && guard < 10000; guard++) {
		if (field(date, interval.unit) % interval.step === 0) values.push(date.getTime());
		advance(date, interval.unit);
	}
	return values;
}
