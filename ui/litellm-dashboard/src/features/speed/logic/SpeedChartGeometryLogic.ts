import { buildMonotonePath } from "../../platform/logic/MonotonePathLogic";
import { formatSpeedBucketLabel, type SpeedChartRow } from "./ModelSpeedLogic";
import { speedTimeTicks } from "./SpeedTimeTickLogic";
import type { SpeedBucket } from "../support/SpeedModels";
import type { SpeedAxisTick, SpeedChartGeometry } from "../support/SpeedChartModels";

/** Original fixed [0, max] Recharts scale; its final tick is the actual maximum. */
export function speedValueTicks(maximum: number): number[] {
	const max = maximum > 0 && Number.isFinite(maximum) ? maximum : 1;
	const rough = max / 4,
		power = Math.floor(Math.log10(rough)) + 1,
		magnitude = 10 ** power;
	const increment = power === 1 ? 0.1 : 0.05;
	const step = Math.ceil(Number((Math.ceil(rough / magnitude / increment - 1e-12) * increment * magnitude).toPrecision(15)));
	const values: number[] = [];
	for (let tick = 0; tick < max - 0.99 * step; tick += step) values.push(tick);
	return [...values, max];
}
/**
 * Recharts preserveEnd uses the whole SVG boundary, not the plot boundary.
 * The old hidden measurement span is observed at body 16px/24px even though
 * the final SVG labels use 10px (OriginalGeometry.json records both).
 */
function visibleTicks(candidates: SpeedAxisTick[], limit: number, size: (tick: SpeedAxisTick) => number, gap: number): SpeedAxisTick[] {
	if (!candidates.length) return [];
	const sign = candidates.length > 1 && candidates[1]!.coordinate < candidates[0]!.coordinate ? -1 : 1;
	const start = sign === 1 ? 0 : limit;
	let end = sign === 1 ? limit : 0;
	const visible: SpeedAxisTick[] = [];
	for (let index = candidates.length - 1; index >= 0; index--) {
		const tick = candidates[index]!;
		let coordinate = tick.coordinate;
		if (index !== candidates.length - 1 && (sign * coordinate < sign * start || sign * coordinate > sign * end)) continue;
		const length = size(tick);
		if (index === candidates.length - 1) {
			const overflow = sign * (coordinate + (sign * length) / 2 - end);
			if (overflow > 0) coordinate -= overflow * sign;
		}
		if (sign * (coordinate - (sign * length) / 2 - start) >= 0 && sign * (coordinate + (sign * length) / 2 - end) <= 0) {
			visible.push({ ...tick, labelCoordinate: coordinate });
			end = coordinate - sign * (length / 2 + gap);
		}
	}
	return visible.reverse();
}
export function speedChartGeometry(input: {
	rows: readonly SpeedChartRow[];
	width: number;
	maximum: number;
	bucket: SpeedBucket;
	timezone: string;
	measureLabel: (label: string) => { width: number; height: number };
}): SpeedChartGeometry {
	const { rows, width, bucket, timezone, measureLabel } = input;
	const height = 88,
		left = 34,
		right = 6,
		top = 4,
		bottom = 18;
	const plotWidth = Math.max(0, width - left - right),
		plotHeight = height - top - bottom;
	const first = rows[0]?.timestamp ?? 0,
		last = rows[rows.length - 1]?.timestamp ?? first;
	const x = (value: number) => left + (last === first ? plotWidth / 2 : ((value - first) / (last - first)) * plotWidth);
	const maximum = input.maximum > 0 && Number.isFinite(input.maximum) ? input.maximum : 1;
	const y = (value: number) => top + plotHeight * (1 - value / maximum);
	const points = rows.map((row) => (row.tps === null ? null : { x: x(row.timestamp), y: y(row.tps) }));
	const dots = rows.flatMap((row, index) => (points[index] ? [{ ...points[index]!, row, index }] : []));
	const xCandidates = speedTimeTicks(first, last).map((value) => ({
		value,
		coordinate: x(value),
		labelCoordinate: x(value),
		label: formatSpeedBucketLabel(value, bucket, timezone),
	}));
	const yCandidates = speedValueTicks(maximum).map((value) => ({
		value,
		coordinate: y(value),
		labelCoordinate: y(value),
		label: String(Math.round(value)),
	}));
	return {
		width,
		height,
		left,
		right,
		top,
		bottom,
		path: buildMonotonePath(points),
		coordinates: rows.map((row) => x(row.timestamp)),
		dots,
		xTicks: visibleTicks(xCandidates, width, (tick) => measureLabel(tick.label).width, 28),
		yTicks: visibleTicks(yCandidates, height, (tick) => measureLabel(tick.label).height, 5),
	};
}
export function speedTooltipPosition(coordinate: number, size: number, start: number, end: number): number {
	const positive = coordinate + 10;
	return Math.max(start, positive + size > end ? coordinate - size - 10 : positive);
}
