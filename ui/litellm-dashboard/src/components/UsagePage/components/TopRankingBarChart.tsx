import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReactNode } from "react";

interface TopRankingBarChartProps<T extends Record<string, unknown>> {
	data: T[];
	categoryKey: keyof T & string;
	valueKey: keyof T & string;
	yAxisWidth: number;
	height: number;
	valueFormatter: (value: number) => string;
	renderTooltip: (row: T | undefined) => ReactNode;
	onBarClick?: (row: T) => void;
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
}: TopRankingBarChartProps<T>) => {
	if (data.length === 0) return null;

	return (
		<ResponsiveContainer width="100%" height={Math.max(data.length * height, height)}>
			<BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
				<XAxis type="number" tickFormatter={valueFormatter} />
				<YAxis type="category" dataKey={categoryKey} width={yAxisWidth} tickLine={false} axisLine={false} />
				<Tooltip
					allowEscapeViewBox={{ x: true, y: true }}
					content={({ active, payload }) => {
						if (!active || !payload?.[0]?.payload) return null;
						return <div className="relative z-50 pointer-events-none">{renderTooltip(payload[0].payload as T)}</div>;
					}}
				/>
				<Bar dataKey={valueKey} fill="#06b6d4" cursor={onBarClick ? "pointer" : undefined} onClick={onBarClick} />
			</BarChart>
		</ResponsiveContainer>
	);
};

export default TopRankingBarChart;
