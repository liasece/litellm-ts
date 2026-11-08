/** Recharts filters category labels with a metric taken before the axis CSS applies.
 * Its hidden measurement span inherits the 16px body font because the axis mounts
 * without tick nodes, so `componentDidMount` never records the rendered 12px size and
 * the filter stays on the inherited metric for the life of the chart. Measuring the
 * labels at their rendered size instead drops one label interval and shifts every
 * remaining date, so the filter below uses the inherited size. */
export const usageCategoryMetricSize = 16;
/** Line and area axes sit inside Tremor’s default text class, so their hidden measurement
 * span resolves 14px before the tick CSS applies and the filter keeps that metric. */
export const usageLineCategoryMetricSize = 14;
/** Preserve the existing chart's five-tick readable domain, including credits below zero. */
export function usageAxisScale(minimum: number, maximum: number, count = 5) {
	const low = Number.isFinite(minimum) ? minimum : 0,
		high = Number.isFinite(maximum) ? maximum : 0,
		min = Math.min(low, high),
		max = Math.max(low, high);
	if (min === max) {
		const ticks = Array.from({ length: count }, (_, index) => index);
		return { min: 0, max: count - 1, step: 1, ticks };
	}
	const rough = (max - min) / (count - 1),
		digits = Math.floor(Math.log10(rough)) + 1,
		power = 10 ** digits,
		ratioStep = digits === 1 ? 0.1 : 0.05;
	for (let correction = 0; correction < 100; correction++) {
		const step = Number(
			((Math.ceil(Number((rough / power / ratioStep).toPrecision(14))) + correction) * ratioStep * power).toPrecision(14),
		);
		if (!Number.isFinite(step) || step <= 0) break;
		const middle = min <= 0 && max >= 0 ? 0 : Math.floor((min + max) / 2 / step) * step;
		let below = Math.ceil(Number(((middle - min) / step).toPrecision(14))),
			above = Math.ceil(Number(((max - middle) / step).toPrecision(14)));
		const length = below + above + 1;
		if (length > count) continue;
		if (max > 0) above += count - length;
		else below += count - length;
		const start = Number((middle - below * step).toPrecision(14)),
			ticks = Array.from({ length: count }, (_, index) => Number((start + index * step).toPrecision(14)));
		return { min: ticks[0], max: ticks.at(-1)!, step, ticks };
	}
	return { min: 0, max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };
}
export function preserveEndTicks(coordinates: readonly number[], sizes: readonly number[], extent: number, gap = 5) {
	if (!coordinates.length) return [];
	const direction = coordinates.length > 1 && coordinates[1] < coordinates[0] ? -1 : 1,
		start = direction > 0 ? 0 : -extent;
	let end = direction > 0 ? extent : 0;
	const visible: { index: number; coordinate: number }[] = [];
	for (let index = coordinates.length - 1; index >= 0; index--) {
		let coordinate = coordinates[index] * direction;
		const half = sizes[index] / 2;
		if (index === coordinates.length - 1) coordinate -= Math.max(0, coordinate + half - end);
		if (coordinate - half >= start && coordinate + half <= end) {
			visible.unshift({ index, coordinate: coordinate * direction });
			end = coordinate - half - gap;
		}
	}
	return visible;
}
export function equidistantStartTicks(coordinates: readonly number[], sizes: readonly number[], start: number, end: number, gap = 5) {
	/* Recharts bounds the category axis against the chart viewBox, which starts after the
	   left gutter, and always keeps the first tick visible. Each accepted tick restarts the
	   monotonic search, so the reported interval is the smallest one that fits. */
	for (let step = 1; step <= coordinates.length; step++) {
		const visible: { index: number; coordinate: number }[] = [];
		let bound = start,
			valid = true;
		for (let index = 0; index < coordinates.length; index += step) {
			const half = sizes[index] / 2,
				coordinate = index === 0 ? Math.max(coordinates[index], half) : coordinates[index];
			if (index !== 0 && (coordinate - half < bound || coordinate + half > end)) {
				valid = false;
				break;
			}
			visible.push({ index, coordinate });
			bound = coordinate + half + gap;
		}
		if (valid) return visible;
	}
	return [];
}
