import type { UsageBarGeometry } from "../support/UsageBarGeometryModels";
export function usageChartRowAt(geometry: UsageBarGeometry, count: number, x: number, y: number, positions?: number[]): number | null {
	if (!count || x < geometry.left || x > geometry.left + geometry.plotWidth || y < geometry.top || y > geometry.top + geometry.plotHeight)
		return null;
	if (positions)
		return positions.reduce((best, position, index) => (Math.abs(x - position) < Math.abs(x - positions[best]) ? index : best), 0);
	const length = geometry.horizontal ? geometry.plotHeight : geometry.plotWidth - 40,
		coordinate = geometry.horizontal ? y - geometry.top : x - geometry.left - 20;
	return Math.min(count - 1, Math.max(0, Math.floor(coordinate / (length / count))));
}
export function usageCategoryCoordinate(geometry: UsageBarGeometry, count: number, index: number, positions?: number[]) {
	if (positions) return positions[index];
	return geometry.horizontal
		? geometry.top + (geometry.plotHeight / count) * (index + 0.5)
		: geometry.left + 20 + ((geometry.plotWidth - 40) / count) * (index + 0.5);
}
