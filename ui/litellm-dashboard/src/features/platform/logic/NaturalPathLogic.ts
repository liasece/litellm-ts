/** Natural cubic interpolation from d3-shape/src/curve/natural.js.
 * The shared d3-shape license is preserved in MonotonePath.LICENSE.
 */
interface NaturalPoint {
	x: number;
	y: number;
}
const number = (value: number) => String(Math.round(value * 1000) / 1000);
const pair = (point: NaturalPoint) => number(point.x) + "," + number(point.y);
function controlPoints(values: readonly number[]): [number[], number[]] {
	const count = values.length - 1;
	const first: number[] = [],
		second: number[] = [],
		right: number[] = [];
	first[0] = 0;
	second[0] = 2;
	right[0] = values[0]! + 2 * values[1]!;
	for (let i = 1; i < count - 1; i++) {
		first[i] = 1;
		second[i] = 4;
		right[i] = 4 * values[i]! + 2 * values[i + 1]!;
	}
	first[count - 1] = 2;
	second[count - 1] = 7;
	right[count - 1] = 8 * values[count - 1]! + values[count]!;
	for (let i = 1; i < count; i++) {
		const ratio = first[i]! / second[i - 1]!;
		second[i]! -= ratio;
		right[i]! -= ratio * right[i - 1]!;
	}
	first[count - 1] = right[count - 1]! / second[count - 1]!;
	for (let i = count - 2; i >= 0; i--) first[i] = (right[i]! - first[i + 1]!) / second[i]!;
	second[count - 1] = (values[count]! + first[count - 1]!) / 2;
	for (let i = 0; i < count - 1; i++) second[i] = 2 * values[i + 1]! - first[i + 1]!;
	return [first, second];
}
export function buildNaturalPath(points: readonly NaturalPoint[]): string {
	const first = points[0];
	if (!first) return "";
	let path = "M" + pair(first);
	if (points.length === 1) return path + "Z";
	if (points.length === 2) return path + "L" + pair(points[1]!);
	const [firstX, secondX] = controlPoints(points.map((p) => p.x)),
		[firstY, secondY] = controlPoints(points.map((p) => p.y));
	for (let i = 1; i < points.length; i++)
		path +=
			"C" +
			number(firstX[i - 1]!) +
			"," +
			number(firstY[i - 1]!) +
			"," +
			number(secondX[i - 1]!) +
			"," +
			number(secondY[i - 1]!) +
			"," +
			pair(points[i]!);
	return path;
}
