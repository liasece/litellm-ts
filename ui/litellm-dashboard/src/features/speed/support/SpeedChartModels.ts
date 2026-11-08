import type { MonotonePoint } from "../../platform/logic/MonotonePathLogic";
import type { SpeedChartRow } from "../logic/ModelSpeedLogic";
export interface SpeedAxisTick {
	value: number;
	coordinate: number;
	labelCoordinate: number;
	label: string;
}
export interface SpeedChartDot extends MonotonePoint {
	index: number;
	row: SpeedChartRow;
}
export interface SpeedChartGeometry {
	width: number;
	height: number;
	left: number;
	right: number;
	top: number;
	bottom: number;
	path: string;
	coordinates: number[];
	dots: SpeedChartDot[];
	xTicks: SpeedAxisTick[];
	yTicks: SpeedAxisTick[];
}
