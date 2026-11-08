import { chartValue } from "./UsageChartLogic";
import { equidistantStartTicks, preserveEndTicks, usageAxisScale, usageCategoryMetricSize } from "./UsageAxisScaleLogic";
import type { UsageAxisTick, UsageBarGeometry, UsageBarGeometryInput, UsageBarShape } from "../support/UsageBarGeometryModels";
function finite(value: unknown) {
	const number = Number(value);
	return Number.isFinite(number) ? number : 0;
}
export function usageBarGeometry(input: UsageBarGeometryInput): UsageBarGeometry {
	const { data, categories, horizontal = false, ranking = false, width, height, yAxisWidth, showXAxis, format, measureText } = input;
	const left = yAxisWidth,
		right = ranking ? 16 : 0,
		top = ranking ? 4 : 5 + (input.legendHeight ?? 0),
		bottom = (ranking ? 4 : 0) + (showXAxis ? 30 : 0),
		plotWidth = Math.max(0, width - left - right),
		plotHeight = Math.max(0, height - top - bottom);
	const rows = data.map((row) => categories.map((key) => finite(chartValue(row, key))));
	let minimum = 0,
		maximum = 0;
	for (const values of rows) {
		if (input.stack) {
			minimum = Math.min(
				minimum,
				values.reduce((sum, v) => sum + Math.min(0, v), 0),
			);
			maximum = Math.max(
				maximum,
				values.reduce((sum, v) => sum + Math.max(0, v), 0),
			);
		} else
			for (const value of values) {
				minimum = Math.min(minimum, value);
				maximum = Math.max(maximum, value);
			}
	}
	const scale = usageAxisScale(minimum, maximum),
		valuePosition = (value: number) =>
			horizontal
				? left + ((value - scale.min) / (scale.max - scale.min)) * plotWidth
				: top + plotHeight - ((value - scale.min) / (scale.max - scale.min)) * plotHeight;
	const padding = horizontal ? 0 : 20,
		band = Math.max(0, ((horizontal ? plotHeight : plotWidth) - 2 * padding) / Math.max(1, data.length));
	const categoryPositions = data.map((_, index) => (horizontal ? top : left) + padding + band * (index + 0.5)),
		labels = data.map((row) => String(chartValue(row, input.index) ?? ""));
	const numericPositions = scale.ticks.map(valuePosition),
		numericLabels = scale.ticks.map((value) => format(value)),
		font = ranking ? 16 : 12;
	const numbers = preserveEndTicks(
		numericPositions,
		numericLabels.map((text) => (horizontal ? measureText(text, font) : 24)),
		horizontal ? width : height,
	);
	const categoryTicks = horizontal
		? preserveEndTicks(
				categoryPositions,
				labels.map(() => 24),
				height,
			)
		: equidistantStartTicks(
				categoryPositions,
				labels.map((text) => measureText(text, usageCategoryMetricSize)),
				/* Recharts bounds the axis against the plot box: it starts after the left
				   gutter and ends at the chart width. */
				left,
				width,
			);
	const xTicks: UsageAxisTick[] = [],
		yTicks: UsageAxisTick[] = [];
	for (const tick of numbers) {
		if (horizontal) {
			if (showXAxis)
				xTicks.push({
					x: tick.coordinate,
					markX: numericPositions[tick.index],
					y: top + plotHeight + 8,
					text: numericLabels[tick.index],
					transform: ranking ? undefined : "translate(-3, 0)",
					anchor: "middle",
					dy: "0.71em",
				});
		} else
			yTicks.push({
				x: left - 8,
				y: tick.coordinate,
				text: numericLabels[tick.index],
				transform: "translate(-3, 0)",
				anchor: "end",
				dy: "0.355em",
			});
	}
	for (const tick of categoryTicks) {
		if (horizontal)
			yTicks.push({
				x: left - 8,
				y: tick.coordinate,
				text: labels[tick.index],
				transform: ranking ? undefined : "translate(0, 6)",
				anchor: "end",
				dy: "0.355em",
			});
		else if (showXAxis)
			xTicks.push({
				x: tick.coordinate,
				y: top + plotHeight + 8,
				text: labels[tick.index],
				transform: "translate(0, 6)",
				anchor: "middle",
				dy: "0.71em",
			});
	}
	const groups = input.stack ? 1 : Math.max(1, categories.length),
		categoryGap = band * 0.1,
		barGap = 4,
		available = (band - 2 * categoryGap - barGap * (groups - 1)) / groups,
		size = Math.max(0, Math.floor(available));
	const bars: UsageBarShape[] = [];
	for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
		let positive = 0,
			negative = 0;
		for (let seriesIndex = 0; seriesIndex < categories.length; seriesIndex++) {
			const value = rows[rowIndex][seriesIndex],
				group = input.stack ? 0 : seriesIndex,
				categoryStart = (horizontal ? top : left) + padding + band * rowIndex + categoryGap + group * (available + barGap);
			const origin = input.stack ? (value >= 0 ? positive : negative) : 0,
				from = valuePosition(origin),
				to = valuePosition(origin + value);
			if (input.stack) {
				if (value >= 0) positive += value;
				else negative += value;
			}
			bars.push({
				row: data[rowIndex],
				rowIndex,
				seriesIndex,
				x: horizontal ? Math.min(from, to) : categoryStart,
				y: horizontal ? categoryStart : Math.min(from, to),
				width: horizontal ? Math.abs(to - from) : size,
				height: horizontal ? size : Math.abs(to - from),
			});
		}
	}
	const grid = ranking
		? []
		: numbers.map((tick) =>
				horizontal
					? { x1: numericPositions[tick.index], y1: top, x2: numericPositions[tick.index], y2: top + plotHeight }
					: { x1: left, y1: numericPositions[tick.index], x2: left + plotWidth, y2: numericPositions[tick.index] },
			);
	return { width, height, left, right, top, bottom, plotWidth, plotHeight, horizontal, ranking, scale, xTicks, yTicks, grid, bars };
}
