/**
 * Steffen monotone interpolation, adapted from d3-shape's monotoneX curve.
 * Source: d3-shape/src/curve/monotone.js; see MonotonePath.LICENSE.
 * SVG coordinates retain the original d3-path three-decimal serialization.
 */
export interface MonotonePoint {
	x: number;
	y: number;
}
export interface MonotonePathOptions {
	/** d3's line renderer closes isolated points; area callers can close their own baseline. */
	closeIsolated?: boolean;
}
const sign = (value: number) => (value < 0 ? -1 : 1);
const number = (value: number) => String(Math.round(value * 1000) / 1000);
const pair = (point: MonotonePoint) => number(point.x) + "," + number(point.y);
function interiorSlope(a: MonotonePoint, b: MonotonePoint, c: MonotonePoint): number {
	const before = b.x - a.x,
		after = c.x - b.x;
	const left = (b.y - a.y) / (before || (after < 0 ? -0 : 0));
	const right = (c.y - b.y) / (after || (before < 0 ? -0 : 0));
	const weighted = (left * after + right * before) / (before + after);
	return (sign(left) + sign(right)) * Math.min(Math.abs(left), Math.abs(right), Math.abs(weighted) / 2) || 0;
}
function endpointSlope(a: MonotonePoint, b: MonotonePoint, adjacent: number): number {
	const width = b.x - a.x;
	return width ? ((3 * (b.y - a.y)) / width - adjacent) / 2 : adjacent;
}
function segment(points: readonly MonotonePoint[], closeIsolated: boolean): string {
	const first = points[0];
	if (!first) return "";
	let path = "M" + pair(first);
	if (points.length === 1) return path + (closeIsolated ? "Z" : "");
	if (points.length === 2) return path + "L" + pair(points[1]!);
	const slopes: number[] = [];
	for (let index = 1; index < points.length - 1; index++)
		slopes[index] = interiorSlope(points[index - 1]!, points[index]!, points[index + 1]!);
	slopes[0] = endpointSlope(first, points[1]!, slopes[1]!);
	slopes[points.length - 1] = endpointSlope(points[points.length - 2]!, points[points.length - 1]!, slopes[points.length - 2]!);
	for (let index = 1; index < points.length; index++) {
		const a = points[index - 1]!,
			b = points[index]!,
			third = (b.x - a.x) / 3;
		path +=
			"C" +
			number(a.x + third) +
			"," +
			number(a.y + third * slopes[index - 1]!) +
			"," +
			number(b.x - third) +
			"," +
			number(b.y - third * slopes[index]!) +
			"," +
			pair(b);
	}
	return path;
}
/** Null/nonfinite coordinates end a segment. Coincident consecutive points are ignored as in d3-shape. */
export function buildMonotonePath(points: readonly (MonotonePoint | null)[], options: MonotonePathOptions = {}): string {
	let path = "";
	let current: MonotonePoint[] = [];
	function flush() {
		path += segment(current, options.closeIsolated !== false);
		current = [];
	}
	for (const point of points) {
		if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
			flush();
			continue;
		}
		const previous = current[current.length - 1];
		if (!previous || previous.x !== point.x || previous.y !== point.y) current.push(point);
	}
	flush();
	return path;
}
