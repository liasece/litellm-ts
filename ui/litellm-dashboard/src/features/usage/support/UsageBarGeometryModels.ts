import type { ChartRow } from "../logic/UsageChartLogic";
export interface UsageAxisTick {
	x: number;
	markX?: number;
	y: number;
	text: string;
	transform?: string;
	anchor: "middle" | "end" | "start";
	dy: string;
}
export interface UsageBarShape {
	row: ChartRow;
	rowIndex: number;
	seriesIndex: number;
	x: number;
	y: number;
	width: number;
	height: number;
}
/** 一个类目在绘图区占的槽位；“无数据”的日期按这个槽位画灰带。 */
export interface UsageCategoryBand {
	index: number;
	x: number;
	y: number;
	width: number;
	height: number;
}
export interface UsageBarGeometry {
	width: number;
	height: number;
	left: number;
	right: number;
	top: number;
	bottom: number;
	plotWidth: number;
	plotHeight: number;
	horizontal: boolean;
	ranking: boolean;
	scale: { min: number; max: number; step: number; ticks: number[] };
	xTicks: UsageAxisTick[];
	yTicks: UsageAxisTick[];
	rightTicks: UsageAxisTick[];
	grid: { x1: number; y1: number; x2: number; y2: number }[];
	bars: UsageBarShape[];
	categoryBands: UsageCategoryBand[];
}
export interface UsageBarGeometryInput {
	data: readonly ChartRow[];
	index: string;
	categories: string[];
	width: number;
	height: number;
	yAxisWidth: number;
	horizontal?: boolean;
	ranking?: boolean;
	stack?: boolean;
	legendHeight?: number;
	showXAxis: boolean;
	rightAxisWidth?: number;
	xAxisLabelAngle?: number;
	format: (value: number) => string;
	measureText: (text: string, fontSize: number) => number;
}
