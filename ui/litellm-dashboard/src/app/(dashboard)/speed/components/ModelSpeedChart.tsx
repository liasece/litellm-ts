import { useId, useMemo } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
	buildSpeedStrokeStops,
	formatTps,
	formatSpeedBucketLabel,
	speedStrokeColor,
	type SpeedChartRow,
} from "../utils";
import type { SpeedBucket } from "../types";

interface ModelSpeedChartProps {
	readonly rows: readonly SpeedChartRow[];
	readonly bucket: SpeedBucket;
	readonly timezone: string;
	/** 当前显示的所有卡片共用的纵轴上限 */
	readonly yMax: number;
}

interface ModelSpeedTooltipProps {
	readonly active?: boolean;
	readonly payload?: ReadonlyArray<{ readonly payload?: SpeedChartRow }>;
}

/**
 * 生成按取值上色的圆点渲染器。
 *
 * 断线之后只剩零星采样点的模型需要圆点才看得见；圆点用固色，避免被折线的纵向渐变
 * 在自身 bounding box 上渲染成一小段全色阶。
 * @param radius - 圆点半径
 */
const createSpeedDotRenderer = (radius: number) =>
	function SpeedDot(props: SpeedDotProps) {
		const { cx, cy, payload } = props;
		if (typeof cx !== "number" || typeof cy !== "number" || !payload || payload.tps === null) {
			return <g />;
		}
		return <circle cx={cx} cy={cy} r={radius} fill={speedStrokeColor(payload.tps)} stroke="none" />;
	};

interface SpeedDotProps {
	readonly cx?: number | string;
	readonly cy?: number | string;
	readonly payload?: SpeedChartRow;
}

/** 图表悬停时展示该时间桶的采样量，避免读者把单请求桶当成稳定值 */
const ModelSpeedTooltip = ({ active, payload }: ModelSpeedTooltipProps) => {
	const row = active ? payload?.[0]?.payload : undefined;
	if (!row) {
		return null;
	}
	if (row.tps === null) {
		return (
			<div className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs shadow-sm">
				<div className="text-gray-500">{row.label}</div>
				<div className="text-gray-500">该时段样本不足，不显示速度</div>
			</div>
		);
	}
	return (
		<div className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs shadow-sm">
			<div className="text-gray-500">{row.label}</div>
			<div className="font-medium text-gray-800">平均 {formatTps(row.tps)} TPS</div>
			<div className="text-gray-500">
				中位 {formatTps(row.p50)} · {row.requests.toLocaleString("en-US")} 个请求
			</div>
		</div>
	);
};


/**
 * 单个模型的输出 TPS 走势。
 *
 * 三条约定叠在一起：
 * 1. 纵轴始终从 0 起、顶部取当前展示的所有卡片的最大值，卡片之间的高度可直接比较；
 * 2. 颜色按绝对速度取值（0 青绿 → 200 满饱和纯红），同样用绝对值，跨卡片可比；
 * 3. 没有样本的时段留空并断线，圆点保证「只有零星采样」的模型也看得见。
 *
 * 渐变贴在折线自身的纵向范围内（objectBoundingBox）：折线上下的值来自同一份数据，
 * 所以「图上的高低」与「取值」一一对应；纵轴从 0 起只改变线的位置，不改变配色映射。
 */
const ModelSpeedChart = ({ rows, bucket, timezone, yMax }: ModelSpeedChartProps) => {
	const gradientId = "speed-stroke-" + useId().replace(/:/g, "");
	const values = useMemo(
		() => rows.reduce<number[]>((acc, row) => (row.tps === null ? acc : [...acc, row.tps]), []),
		[rows],
	);
	const dataMin = values.length > 0 ? Math.min(...values) : 0;
	const dataMax = values.length > 0 ? Math.max(...values) : 0;
	const stops = useMemo(() => buildSpeedStrokeStops(dataMin, dataMax), [dataMin, dataMax]);
	const tickFormatter = useMemo(
		() => (value: number) => formatSpeedBucketLabel(value, bucket, timezone),
		[bucket, timezone],
	);
	const renderDot = createSpeedDotRenderer(rows.length > 80 ? 1.6 : 2.4);

	if (rows.length === 0 || values.length === 0) {
		return null;
	}

	const first = rows[0]!;
	const last = rows[rows.length - 1]!;
	// 纵轴上限由调用方统一给出；没有数值时退化为 1，避免 0 高度轴
	const axisMax = yMax > 0 ? yMax : 1;

	return (
		<div className="mt-2 w-full" style={{ height: 88 }} data-testid="model-speed-chart">
			<ResponsiveContainer width="100%" height="100%">
				<LineChart data={rows as SpeedChartRow[]} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
					<defs>
						<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
							{stops.map((stop) => (
								<stop
									key={stop.offset.toFixed(4) + stop.color}
									offset={stop.offset}
									stopColor={stop.color}
								/>
							))}
						</linearGradient>
					</defs>
					<XAxis
						dataKey="timestamp"
						type="number"
						scale="time"
						domain={[first.timestamp, last.timestamp]}
						height={18}
						tickFormatter={tickFormatter}
						tick={{ fontSize: 10 }}
						minTickGap={28}
						stroke="#9ca3af"
					/>
					<YAxis
						width={34}
						domain={[0, axisMax]}
						allowDecimals={false}
						tick={{ fontSize: 10 }}
						tickFormatter={(value: number) => String(Math.round(value))}
						stroke="#9ca3af"
					/>
					<Tooltip content={<ModelSpeedTooltip />} />
					<Line
						type="monotone"
						dataKey="tps"
						stroke={"url(#" + gradientId + ")"}
						strokeWidth={2}
						connectNulls={false}
						dot={renderDot}
						activeDot={false}
						isAnimationActive={false}
					/>
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
};

export default ModelSpeedChart;
