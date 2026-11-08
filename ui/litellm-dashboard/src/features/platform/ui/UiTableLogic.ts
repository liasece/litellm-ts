import type { UiTableColumn, UiTableRow, UiTableSort } from "./UiTypes";

export function readTableValue(row: UiTableRow, column: UiTableColumn): unknown {
	const path = column.dataIndex ?? column.key;
	const segments = typeof path === "string" ? path.split(".") : path;
	let value: unknown = row;
	for (const segment of segments) {
		if (value === null || typeof value !== "object") return undefined;
		value = (value as Record<string, unknown>)[segment];
	}
	return value;
}

export function sortTableRows(rows: readonly UiTableRow[], columns: readonly UiTableColumn[], sort: UiTableSort): readonly UiTableRow[] {
	if (!sort.order) return rows;
	const column = columns.find((candidate) => candidate.key === sort.key);
	if (!column) return rows;
	const direction = sort.order === "asc" ? 1 : -1;
	return [...rows].sort((left, right) => {
		const a = readTableValue(left, column);
		const b = readTableValue(right, column);
		if (a == null && b == null) return 0;
		if (a == null) return 1;
		if (b == null) return -1;
		const difference =
			typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true });
		return difference * direction;
	});
}

export function displayTableValue(value: unknown): string {
	if (value == null) return "—";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}
