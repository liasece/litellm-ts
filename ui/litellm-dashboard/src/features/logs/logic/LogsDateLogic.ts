const pad = (value: number): string => String(value).padStart(2, "0");
export function localDateTime(date: Date = new Date()): string {
	return (
		date.getFullYear() +
		"-" +
		pad(date.getMonth() + 1) +
		"-" +
		pad(date.getDate()) +
		"T" +
		pad(date.getHours()) +
		":" +
		pad(date.getMinutes())
	);
}
export function isLocalDateTime(value: string | null): value is string {
	if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
	const date = new Date(value);
	return Number.isFinite(date.getTime()) && localDateTime(date) === value;
}
export function subtractInterval(value: number, unit: string, now: Date = new Date()): string {
	const multiplier = unit === "minutes" ? 60_000 : unit === "days" ? 86_400_000 : 3_600_000;
	// Calendar-day subtraction follows the existing local-day semantics through DST.
	if (unit === "days") {
		const date = new Date(now);
		date.setDate(date.getDate() - value);
		return localDateTime(date);
	}
	return localDateTime(new Date(now.getTime() - value * multiplier));
}
export function utcApiDate(value: string | Date): string {
	const date = value instanceof Date ? value : new Date(value);
	if (!Number.isFinite(date.getTime())) throw new Error("Invalid log date range");
	return date.toISOString().slice(0, 19).replace("T", " ");
}
