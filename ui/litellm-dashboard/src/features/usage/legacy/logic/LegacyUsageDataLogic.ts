import type { LegacyRow } from "../api/LegacyUsageApi";
import type { KeyRanking } from "../../support/UsageModels";
export function legacyMonth(now = new Date()) {
	const first = new Date(now.getFullYear(), now.getMonth(), 1),
		last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
	const format = (day: Date) =>
		[day.getFullYear(), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0")].join("-");
	return { first, last, from: format(first), to: format(last) };
}
export function legacyRows(value: unknown): LegacyRow[] {
	return Array.isArray(value)
		? value.filter((row): row is LegacyRow => Boolean(row && typeof row === "object" && !Array.isArray(row)))
		: [];
}
export function fillLegacyDates(data: LegacyRow[], start: Date, end: Date, categories: string[], now = new Date()): LegacyRow[] {
	function standardize(value: unknown) {
		if (typeof value !== "string") throw new Error("Invalid spend date");
		if (value.includes("-")) return value;
		const [month, day] = value.split(" ");
		const index = new Date(month + " 01 2024").getMonth();
		return new Date(now.getFullYear(), index, Number.parseInt(day)).toISOString().split("T")[0];
	}
	const existing = new Map(
			data.map((item) => {
				const date = standardize(item.date);
				return [date, { ...item, date }];
			}),
		),
		filled: LegacyRow[] = [],
		current = new Date(start);
	while (current <= end) {
		const date = current.toISOString().split("T")[0];
		filled.push(
			existing.get(date) || {
				date,
				api_requests: 0,
				total_tokens: 0,
				...Object.fromEntries(categories.map((category) => [category, 0])),
			},
		);
		current.setDate(current.getDate() + 1);
	}
	return filled;
}
export function legacyKeyRankings(rows: LegacyRow[]): KeyRanking[] {
	return rows.map((row) => ({
		api_key: String(row.api_key),
		key_alias: String(row.key_alias || ""),
		spend: Number(row.total_spend),
		tags: [],
	}));
}
export function legacyAdmin(role: string): boolean {
	return role === "Admin" || role === "Admin Viewer";
}
export function compactLegacyNumber(value: number): string {
	return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, notation: "compact", compactDisplay: "short" }).format(value);
}
