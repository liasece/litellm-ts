export interface UsageRankingViewport {
	width: number;
	height: number;
	scale: number;
	offsetX: number;
	offsetY: number;
	pointerScale: number;
}

/** The original ranking SVG uses its rounded viewBox with xMidYMid meet. */
export function usageRankingViewport(
	width: number,
	height: number,
	viewportWidth: number,
	viewportHeight: number,
): UsageRankingViewport | null {
	if (width <= 0 || height <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return null;
	const scale = Math.min(viewportWidth / width, viewportHeight / height);
	return {
		width,
		height,
		scale,
		offsetX: (viewportWidth - width * scale) / 2,
		offsetY: (viewportHeight - height * scale) / 2,
		pointerScale: viewportWidth / width,
	};
}

export function usageDrawingPoint(viewport: UsageRankingViewport | null, x: number, y: number) {
	return viewport ? { x: (x - viewport.offsetX) / viewport.scale, y: (y - viewport.offsetY) / viewport.scale } : { x, y };
}
