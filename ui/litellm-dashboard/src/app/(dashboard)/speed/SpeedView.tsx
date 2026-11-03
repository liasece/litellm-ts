"use client";

import { Alert, Empty, Input, Select, Spin } from "antd";
import { useMemo, useState } from "react";
import { formatNumberWithCommas } from "@/utils/dataUtils";
import ModelSpeedCard from "./components/ModelSpeedCard";
import { useModelSpeed } from "./hooks/useModelSpeed";
import {
	filterSpeedModels,
	resolveSpeedAxisMax,
	resolveSpeedRange,
	SPEED_FULL_SATURATION_TPS,
	SPEED_RANGE_OPTIONS,
	speedStrokeColor,
} from "./utils";

const DEFAULT_RANGE_DAYS = 7;

/** 颜色图例：0 TPS 青绿，200 TPS 满饱和纯红 */
const SpeedColorLegend = () => (
	<span className="flex items-center gap-1.5">
		<span className="text-gray-500">越红越快</span>
		<span
			aria-hidden="true"
			className="inline-block h-2 w-20 rounded-sm"
			style={{
				background:
					"linear-gradient(90deg, " +
					speedStrokeColor(0) +
					", " +
					speedStrokeColor(SPEED_FULL_SATURATION_TPS / 2) +
					", " +
					speedStrokeColor(SPEED_FULL_SATURATION_TPS) +
					")",
			}}
		/>
		<span className="text-gray-500">0 / {SPEED_FULL_SATURATION_TPS} TPS</span>
	</span>
);


/**
 * OBSERVABILITY > Speed
 *
 * 列出区间内有调用记录的模型，并给出每个模型「输出 TPS 随时间变化」的图表。
 * 图表按模型分开画：把 20 多个模型塞进同一张多折线图会互相遮挡，也看不出各自的量级。
 */
const SpeedView = () => {
	// 浏览器时区决定「每天」从哪里切分；后端按同一时区分桶
	const timezone = useMemo(() => {
		try {
			return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
		} catch {
			return "UTC";
		}
	}, []);

	const [rangeDays, setRangeDays] = useState(DEFAULT_RANGE_DAYS);
	const [modelQuery, setModelQuery] = useState("");
	const range = useMemo(() => resolveSpeedRange(rangeDays, timezone), [rangeDays, timezone]);
	const { data, isPending, isError, error } = useModelSpeed({
		startDate: range.startDate,
		endDate: range.endDate,
		timezone,
	});

	const models = useMemo(() => filterSpeedModels(data?.models ?? [], modelQuery), [data?.models, modelQuery]);
	// 纵轴上限取「当前显示」的模型（含搜索结果），让所有卡片同一刻度
	const axisMax = useMemo(() => resolveSpeedAxisMax(models), [models]);
	const modelsWithoutSpeed = data?.models_without_speed ?? [];
	const measurableCount = data?.models.length ?? 0;
	const bucketHint = data?.bucket === "hour" ? "按小时聚合" : "按天聚合";
	const minTokens = data?.min_output_tokens ?? 20;
	const minBucketRequests = data?.min_bucket_requests ?? 3;

	return (
		<div className="flex flex-col gap-4 p-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h1 className="text-lg font-semibold text-gray-900">Speed</h1>
					<p className="mt-1 max-w-3xl text-xs text-gray-500">
						输出 TPS = 输出 token 数 ÷ 请求总耗时，与 Logs 页「输出 TPS」列同一口径。
						按<strong className="font-medium text-gray-600">实际执行请求的上游模型</strong>归组：
						发生 fallback 时算在真正执行的模型上，而不是客户端请求的模型名。
						只统计输出不少于 {minTokens} 个 token、且耗时大于 0 的调用；每个时间段至少要有{" "}
						{minBucketRequests} 个请求才作为数据点，样本不足的时段留空、曲线在那里断开。
						纵轴固定从 0 起，曲线越红表示越快。
					</p>
				</div>
				<Select
					aria-label="统计区间"
					className="w-40"
					value={rangeDays}
					onChange={(value: number) => setRangeDays(value)}
					options={SPEED_RANGE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
				/>
			</div>

			{isError ? (
				<Alert type="error" showIcon message="加载模型速度失败" description={(error as Error)?.message ?? "请稍后重试"} />
			) : null}

			{isPending && !data ? (
				<div className="flex items-center justify-center py-16">
					<Spin tip="正在加载模型速度…" />
				</div>
			) : null}

			{data ? (
				<>
					<div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
						<span>
							{range.startDate} 至 {range.endDate}（{timezone}，{bucketHint}）
						</span>
						<span className="text-gray-300">|</span>
						<span>{formatNumberWithCommas(measurableCount)} 个模型有可测算的输出速度</span>
						{modelsWithoutSpeed.length > 0 ? (
							<>
								<span className="text-gray-300">|</span>
								<span>另有 {formatNumberWithCommas(modelsWithoutSpeed.length)} 个模型有调用但没有可测算输出</span>
							</>
						) : null}
						{measurableCount > 0 ? (
							<>
								<span className="text-gray-300">|</span>
								<SpeedColorLegend />
							</>
						) : null}
					</div>

					{measurableCount > 0 ? (
						<Input
							allowClear
							aria-label="搜索模型"
							className="max-w-xs"
							placeholder="搜索模型名"
							value={modelQuery}
							onChange={(event) => setModelQuery(event.target.value)}
						/>
					) : null}

					{models.length > 0 ? (
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
							{models.map((model) => (
								<ModelSpeedCard
									key={model.model}
									model={model}
									buckets={data.buckets}
									bucket={data.bucket}
									timezone={data.timezone}
									yMax={axisMax}
								/>
							))}
						</div>
					) : (
						<Empty
							description={
								measurableCount > 0
									? "没有匹配「" + modelQuery.trim() + "」的模型"
									: "所选区间内没有可测算的输出速度数据"
							}
						/>
					)}

					{modelsWithoutSpeed.length > 0 ? (
						<div className="rounded-lg border border-dashed border-gray-200 p-3">
							<div className="text-xs font-medium text-gray-700">有调用但没有可测算输出速度的模型</div>
							<p className="mt-1 text-[11px] text-gray-500">
								这些模型在区间内只有不可测算的调用（例如图片生成、检索工具、失败请求，或输出不足 {minTokens} 个
								token），或者每个时段的样本都少于 {minBucketRequests} 个请求；因此没有 TPS 曲线。列出它们是为了说明「为什么这里有模型却没有图」。
							</p>
							<div className="mt-2 flex flex-wrap gap-2">
								{modelsWithoutSpeed.map((entry) => (
									<span
										key={entry.model}
										className="rounded bg-gray-100 px-2 py-1 font-mono text-[11px] text-gray-700"
										title={entry.model + " · " + String(entry.calls) + " 次调用"}
									>
										{entry.model}
										<span className="ml-1 text-gray-500">({formatNumberWithCommas(entry.calls)})</span>
									</span>
								))}
							</div>
						</div>
					) : null}
				</>
			) : null}
		</div>
	);
};

export default SpeedView;
