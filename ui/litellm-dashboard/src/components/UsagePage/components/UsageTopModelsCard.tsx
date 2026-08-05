import { Card, Title } from "@tremor/react";
import { DatabaseOutlined } from "@ant-design/icons";
import { formatNumberWithCommas } from "@/utils/dataUtils";
import { ChartLoader } from "../../shared/chart_loader";
import { valueFormatterSpend } from "../utils/value_formatters";
import TopRankingBarChart from "./TopRankingBarChart";

export type TopModelUsage = Record<string, unknown> & {
	key: string;
	spend: number;
	requests: number;
	successful_requests: number;
	failed_requests: number;
	tokens: number;
	prompt_tokens: number;
	cache_read_input_tokens: number;
};

export const calculateInputCacheHitRate = (cacheReadInputTokens: number, promptTokens: number): number => {
	if (!Number.isFinite(cacheReadInputTokens) || !Number.isFinite(promptTokens) || promptTokens <= 0) return 0;
	return Math.round(Math.min(Math.max(cacheReadInputTokens / promptTokens, 0), 1) * 100);
};

interface UsageTopModelsCardProps {
	viewType: "groups" | "individual";
	onViewTypeChange: (viewType: "groups" | "individual") => void;
	groupModels: TopModelUsage[];
	individualModels: TopModelUsage[];
	loading: boolean;
	isDateChanging: boolean;
}

export default function UsageTopModelsCard({
	viewType,
	onViewTypeChange,
	groupModels,
	individualModels,
	loading,
	isDateChanging,
}: UsageTopModelsCardProps) {
	const modelData = viewType === "groups" ? groupModels : individualModels;

	return (
		<Card className="h-full !p-4">
			<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
				<Title>{viewType === "groups" ? "Top Public Model Names" : "Top Litellm Models"}</Title>
				<div className="flex rounded-md bg-slate-100 p-0.5">
					<button
						className={`rounded px-2 py-1 text-xs transition-colors ${
							viewType === "groups" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
						}`}
						onClick={() => onViewTypeChange("groups")}
					>
						Public Model Name
					</button>
					<button
						className={`rounded px-2 py-1 text-xs transition-colors ${
							viewType === "individual" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
						}`}
						onClick={() => onViewTypeChange("individual")}
					>
						Litellm Model Name
					</button>
				</div>
			</div>
			{loading ? (
				<ChartLoader isDateChanging={isDateChanging} />
			) : (
				<div className="relative max-h-[320px] overflow-y-auto">
					<TopRankingBarChart
						data={modelData}
						categoryKey="key"
						valueKey="spend"
						yAxisWidth={160}
						height={40}
						valueFormatter={valueFormatterSpend}
						renderBarAnnotation={(data) => {
							const cacheHitRate = calculateInputCacheHitRate(data.cache_read_input_tokens, data.prompt_tokens);
							return (
								<span
									className="inline-flex items-center gap-1 text-[11px] text-gray-500"
									aria-label={`Input cache hit rate: ${cacheHitRate}%`}
								>
									<DatabaseOutlined aria-hidden />
									{cacheHitRate}%
								</span>
							);
						}}
						renderTooltip={(data) =>
							data && (
								<div className="rounded-lg border bg-white p-3 text-xs shadow-lg">
									<p className="font-bold">{data.key}</p>
									<p className="text-cyan-500">Spend: ${formatNumberWithCommas(data.spend, 2)}</p>
									<p className="text-gray-600">Total Requests: {data.requests.toLocaleString()}</p>
									<p className="text-green-600">Successful: {data.successful_requests.toLocaleString()}</p>
									<p className="text-red-600">Failed: {data.failed_requests.toLocaleString()}</p>
									<p className="text-gray-600">Tokens: {formatNumberWithCommas(data.tokens, 0, false)}</p>
									<p className="text-gray-600">
										Input Cache Hit: {calculateInputCacheHitRate(data.cache_read_input_tokens, data.prompt_tokens)}%
									</p>
								</div>
							)
						}
					/>
				</div>
			)}
		</Card>
	);
}
