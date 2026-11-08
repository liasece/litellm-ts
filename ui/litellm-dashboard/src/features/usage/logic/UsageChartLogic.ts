export const usageColors: Record<string, string> = {
	emerald: "#10b981",
	amber: "#f59e0b",
	gray: "#6b7280",
	lime: "#84cc16",
	yellow: "#eab308",
	cyan: "#06b6d4",
	blue: "#3b82f6",
	indigo: "#6366f1",
	green: "#22c55e",
	red: "#ef4444",
	purple: "#a855f7",
	violet: "#8b5cf6",
	fuchsia: "#d946ef",
	pink: "#ec4899",
	rose: "#f43f5e",
	orange: "#f97316",
};
export type ChartRow = Record<string, unknown>;
export function chartValue(row: ChartRow, path: string): unknown {
	if (Object.hasOwn(row, path)) return row[path];
	return path
		.split(".")
		.reduce<unknown>(
			(value, key) =>
				value && typeof value === "object" ? (Object.hasOwn(value, key) ? (value as ChartRow)[key] : undefined) : undefined,
			row,
		);
}
export function cacheHitRate(read: number, prompt: number): number {
	if (!Number.isFinite(read) || !Number.isFinite(prompt) || prompt <= 0) return 0;
	return Math.round(Math.min(Math.max(read / prompt, 0), 1) * 100);
}
