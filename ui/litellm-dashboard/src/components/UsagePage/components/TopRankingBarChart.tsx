import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LabelProps } from "recharts";
import { useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

interface TopRankingBarChartProps<T extends Record<string, unknown>> {
	data: T[];
	categoryKey: keyof T & string;
	valueKey: keyof T & string;
	yAxisWidth: number;
	height: number;
	valueFormatter: (value: number) => string;
	renderTooltip: (row: T | undefined) => ReactNode;
	onBarClick?: (row: T) => void;
	renderBarAnnotation?: (row: T) => ReactNode;
}

const TopRankingBarChart = <T extends Record<string, unknown>>({
	data,
	categoryKey,
	valueKey,
	yAxisWidth,
	height,
	valueFormatter,
	renderTooltip,
	onBarClick,
	renderBarAnnotation,
}: TopRankingBarChartProps<T>) => {
	const chartContainerRef = useRef<HTMLDivElement>(null);
	const chartHeight = Math.max(data.length * height, height);

	if (data.length === 0) return null;

	const renderAnnotation = ({ index, viewBox }: LabelProps) => {
		if (
			index === undefined ||
			!viewBox ||
			!("x" in viewBox) ||
			!("y" in viewBox) ||
			!("width" in viewBox) ||
			!("height" in viewBox) ||
			viewBox.x === undefined ||
			viewBox.y === undefined ||
			viewBox.width === undefined ||
			viewBox.height === undefined
		) {
			return null;
		}

		const row = data[index];
		if (!row) return null;

		return (
			<foreignObject x={viewBox.x + 8} y={viewBox.y} width={58} height={viewBox.height}>
				<div className="flex h-full items-center overflow-hidden whitespace-nowrap">{renderBarAnnotation?.(row)}</div>
			</foreignObject>
		);
	};

	return (
		<div ref={chartContainerRef} style={{ height: chartHeight }}>
			<ResponsiveContainer width="100%" height="100%">
				<BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
					<XAxis type="number" tickFormatter={valueFormatter} />
					<YAxis type="category" dataKey={categoryKey} width={yAxisWidth} tickLine={false} axisLine={false} />
					<Tooltip
						content={({ active, payload, coordinate }) => {
							if (
								typeof document === "undefined" ||
								!active ||
								!payload?.[0]?.payload ||
								coordinate?.x === undefined ||
								coordinate.y === undefined
							) {
								return null;
							}

							const chartContainer = chartContainerRef.current;
							if (!chartContainer) return null;
							const chartBounds = chartContainer.getBoundingClientRect();

							const scrollViewportBounds = chartContainer.parentElement?.getBoundingClientRect() ?? chartBounds;
							const anchorX = chartBounds.left + coordinate.x;
							const anchorY = chartBounds.top + coordinate.y;
							const showAbove = anchorY > scrollViewportBounds.top + scrollViewportBounds.height / 2;
							const showLeft = anchorX > scrollViewportBounds.left + (scrollViewportBounds.width * 2) / 3;

							return createPortal(
								<div
									data-testid="top-ranking-tooltip-portal"
									className="pointer-events-none fixed z-[100]"
									style={{
										left: anchorX + (showLeft ? -8 : 8),
										top: anchorY + (showAbove ? -8 : 8),
										transform: `translate(${showLeft ? "-100%" : "0"}, ${showAbove ? "-100%" : "0"})`,
									}}
								>
									{renderTooltip(payload[0].payload as T)}
								</div>,
								document.body,
							);
						}}
					/>
					<Bar dataKey={valueKey} fill="#06b6d4" cursor={onBarClick ? "pointer" : undefined} onClick={onBarClick}>
						{renderBarAnnotation && <LabelList content={renderAnnotation} />}
					</Bar>
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
};

export default TopRankingBarChart;
