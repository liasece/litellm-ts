import { chartValue, usageColors, type ChartRow } from "./UsageChartLogic";
export interface UsageDonutSector {
	row: ChartRow;
	index: number;
	name: string;
	value: number;
	color: string;
	start: number;
	end: number;
	anchor: { x: number; y: number };
}
export function usageDonutGeometry(input: {
	data: readonly ChartRow[];
	index: string;
	category: string;
	colors: readonly string[];
	width: number;
	height: number;
}) {
	const center = { x: input.width / 2, y: input.height / 2 };
	const outerRadius = Math.max(0, Math.min(input.width, input.height) / 2);
	const innerRadius = outerRadius * 0.75;
	const values = input.data.map((row) => {
		const value = chartValue(row, input.category);
		return typeof value === "number" && Number.isFinite(value) ? value : 0;
	});
	const total = values.reduce((sum, value) => sum + value, 0);
	let angle = 90;
	const sectors: UsageDonutSector[] = input.data.map((row, index) => {
		const start = angle,
			value = values[index]!;
		const end = start - (total > 0 ? (value / total) * 360 : 0);
		angle = end;
		const middle = (((start + end) / 2) * Math.PI) / 180;
		const radius = (innerRadius + outerRadius) / 2;
		const colorName = input.colors[index % input.colors.length] ?? "cyan";
		return {
			row,
			index,
			name: String(chartValue(row, input.index) ?? ""),
			value,
			color: usageColors[colorName] ?? colorName,
			start,
			end,
			anchor: { x: center.x + radius * Math.cos(middle), y: center.y - radius * Math.sin(middle) },
		};
	});
	return { center, outerRadius, innerRadius, total, sectors };
}
/** Recharts' item tooltip uses the sector midpoint, with 10px offset and chart bounds. */
export function usageDonutTooltipPosition(coordinate: number, size: number, limit: number): number {
	const positive = coordinate + 10;
	return Math.max(0, positive + size > limit ? coordinate - size - 10 : positive);
}
