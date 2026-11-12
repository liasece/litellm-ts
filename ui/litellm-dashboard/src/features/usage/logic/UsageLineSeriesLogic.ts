import type { usageLineGeometry } from "./UsageLineGeometryLogic";
function opacity(color: string, value: number) {
	if (/^#[a-f0-9]{6}$/i.test(color))
		return `rgba(${parseInt(color.slice(1, 3), 16)},${parseInt(color.slice(3, 5), 16)},${parseInt(color.slice(5, 7), 16)},${value})`;
	return color;
}
export function usageLineSeries(layout: ReturnType<typeof usageLineGeometry>, palette: string[], area: boolean) {
	return layout.series.map((series, index) => {
		const color = palette[index % palette.length],
			paths = series.linePaths;
		const fill = {
			type: "linear",
			x: 0,
			y: 0,
			x2: 0,
			y2: 1,
			colorStops: [
				{ offset: 0.05, color: opacity(color, 0.4) },
				{ offset: 0.95, color: opacity(color, 0) },
			],
		};
		return {
			name: series.key,
			type: "custom",
			coordinateSystem: "none",
			emphasis: { disabled: true },
			data: series.points.map((point, rowIndex) => [rowIndex, point?.y ?? null]),
			renderItem: (params: { dataIndex: number }) => {
				const point = series.points[params.dataIndex],
					children: object[] = [];
				if (params.dataIndex === 0)
					for (let segment = 0; segment < paths.length; segment++) {
						if (area)
							children.push({
								type: "path",
								shape: { pathData: series.areaPaths[segment] },
								style: { fill, fillOpacity: 0.6, stroke: null },
							});
						children.push({
							type: "path",
							shape: { pathData: paths[segment] },
							style: { fill: null, stroke: color, lineWidth: 2, lineJoin: "round", lineCap: "round" },
						});
					}
				if (point && series.showDots)
					children.push({
						type: "circle",
						shape: { cx: point.x, cy: point.y, r: 5 },
						style: { fill: color, stroke: "#fff", lineWidth: 2 },
					});
				return { type: "group", children };
			},
		};
	});
}
export function usageSecondaryLineSeries(layout: ReturnType<typeof usageLineGeometry>, palette: string[], dashed = true) {
	return layout.secondarySeries.map((series, index) => {
		const color = palette[index % palette.length];
		return {
			name: series.key,
			type: "custom",
			coordinateSystem: "none",
			emphasis: { disabled: true },
			data: series.points.map((point, rowIndex) => [rowIndex, point?.y ?? null]),
			renderItem: (params: { dataIndex: number }) => {
				const point = series.points[params.dataIndex],
					children: object[] = [];
				if (params.dataIndex === 0)
					for (const path of series.linePaths)
						children.push({
							type: "path",
							shape: { pathData: path },
							style: {
								fill: null,
								stroke: color,
								lineWidth: 2,
								lineDash: dashed ? [6, 4] : undefined,
								lineJoin: "round",
								lineCap: "round",
							},
						});
				if (point && series.showDots)
					children.push({
						type: "circle",
						shape: { cx: point.x, cy: point.y, r: 4 },
						style: { fill: color, stroke: "#fff", lineWidth: 2 },
					});
				return { type: "group", children };
			},
		};
	});
}
