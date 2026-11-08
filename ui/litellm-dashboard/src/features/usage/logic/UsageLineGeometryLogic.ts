import { buildNaturalPath } from "../../platform/logic/NaturalPathLogic";
import { chartValue, type ChartRow } from "./UsageChartLogic";
import { usageBarGeometry } from "./UsageBarGeometryLogic";
import { equidistantStartTicks, usageLineCategoryMetricSize } from "./UsageAxisScaleLogic";
import type { UsageBarGeometryInput } from "../support/UsageBarGeometryModels";
export interface UsageLinePoint {
	x: number;
	y: number;
	rowIndex: number;
	row: ChartRow;
}
export interface UsageLineGeometryInput extends UsageBarGeometryInput {
	curve?: "linear" | "natural";
	connectNulls?: boolean;
}
export function usageLineGeometry(input: UsageLineGeometryInput) {
	const axes = usageBarGeometry(input);
	const positions = input.data.map((_, index) =>
		input.data.length === 1
			? axes.left + axes.plotWidth / 2
			: axes.left + 20 + ((axes.plotWidth - 40) * index) / (input.data.length - 1),
	);
	const labels = input.data.map((row) => String(chartValue(row, input.index) ?? ""));
	axes.xTicks = input.showXAxis
		? equidistantStartTicks(
				positions,
				labels.map((text) => input.measureText(text, usageLineCategoryMetricSize)),
				axes.left,
				input.width,
			).map((tick) => ({
				x: tick.coordinate,
				y: axes.top + axes.plotHeight + 8,
				text: labels[tick.index],
				transform: "translate(0, 6)",
				anchor: "middle" as const,
				dy: "0.71em",
			}))
		: [];
	const y = (value: number) =>
		axes.top + axes.plotHeight - ((value - axes.scale.min) / (axes.scale.max - axes.scale.min)) * axes.plotHeight;
	const baseline = y(0);
	const series = input.categories.map((key) => {
		const points = input.data.map((row, rowIndex): UsageLinePoint | null => {
			const value = chartValue(row, key);
			return value != null && Number.isFinite(Number(value)) ? { x: positions[rowIndex], y: y(Number(value)), rowIndex, row } : null;
		});
		const segments: UsageLinePoint[][] = [];
		let current: UsageLinePoint[] = [];
		for (const point of points) {
			if (point) current.push(point);
			else if (current.length && !input.connectNulls) {
				segments.push(current);
				current = [];
			}
		}
		if (current.length) segments.push(current);
		const rounded = (value: number) => String(Math.round(value * 1000) / 1000);
		const linePaths = segments.map((segment) =>
			input.curve === "natural"
				? buildNaturalPath(segment)
				: segment.map((point, index) => (index ? "L" : "M") + rounded(point.x) + "," + rounded(point.y)).join(""),
		);
		const areaPaths = segments.map(
			(segment, index) =>
				linePaths[index] +
				[...segment]
					.reverse()
					.map((point) => "L" + rounded(point.x) + "," + rounded(baseline))
					.join("") +
				"Z",
		);
		// Tremor checks literal own keys to decide whether to show isolated dots.
		const showDots = input.data.filter((row) => Object.hasOwn(row, key)).length <= 1;
		return { key, points, linePaths, areaPaths, showDots };
	});
	return { axes, series, positions, baseline };
}
