import { useMemo } from "react";
import { formatNumberWithCommas } from "@/utils/dataUtils";
import ModelSpeedChart from "./ModelSpeedChart";
import { buildSpeedChartRows, formatTps } from "../utils";
import type { SpeedBucket, SpeedModelSeries } from "../types";

interface ModelSpeedCardProps {
	readonly model: SpeedModelSeries;
	/** 完整桶时间轴，用于把缺口留成空档 */
	readonly buckets: readonly string[];
	readonly bucket: SpeedBucket;
	readonly timezone: string;
	/** 当前显示的所有卡片共用的纵轴上限 */
	readonly yMax: number;
}

/**
 * 单个模型的输出速度卡片：模型名、平均/中位 TPS、样本量，以及 TPS 随时间的变化。
 */
const ModelSpeedCard = ({ model, buckets, bucket, timezone, yMax }: ModelSpeedCardProps) => {
	const rows = useMemo(
		() => buildSpeedChartRows(model.points, buckets, bucket, timezone),
		[model.points, buckets, bucket, timezone],
	);

	return (
		<div
			className="flex h-full flex-col rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
			data-testid="model-speed-card"
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="truncate text-sm font-medium text-gray-800" title={model.model}>
						{model.model}
					</div>
					<div className="mt-0.5 text-xs text-gray-500">
						{formatNumberWithCommas(model.requests)} 个可用请求
					</div>
				</div>
				<div className="shrink-0 text-right">
					<div className="font-mono text-lg font-semibold tabular-nums text-gray-900">
						{formatTps(model.avg_tps)}
					</div>
					<div className="text-[10px] font-medium uppercase tracking-wide text-gray-400">TPS</div>
				</div>
			</div>
			<ModelSpeedChart rows={rows} bucket={bucket} timezone={timezone} yMax={yMax} />
			<div className="mt-auto pt-1 text-[11px] text-gray-400">
				中位 {formatTps(model.p50_tps)} TPS · 全部调用 {formatNumberWithCommas(model.calls)}
			</div>
		</div>
	);
};

export default ModelSpeedCard;
