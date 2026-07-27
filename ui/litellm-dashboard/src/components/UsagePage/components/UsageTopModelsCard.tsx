import { Card, Title } from "@tremor/react";
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
		<Card className="h-full">
			<Title>{viewType === "groups" ? "Top Public Model Names" : "Top Litellm Models"}</Title>
			<div className="flex justify-end items-center mb-4">
				<div className="flex bg-gray-100 rounded-lg p-1">
					<button
						className={`px-3 py-1 text-sm rounded-md transition-colors ${
							viewType === "groups" ? "bg-white shadow-sm text-gray-900" : "text-gray-600 hover:text-gray-900"
						}`}
						onClick={() => onViewTypeChange("groups")}
					>
						Public Model Name
					</button>
					<button
						className={`px-3 py-1 text-sm rounded-md transition-colors ${
							viewType === "individual"
								? "bg-white shadow-sm text-gray-900"
								: "text-gray-600 hover:text-gray-900"
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
				<div className="relative max-h-[600px] overflow-y-auto">
					<TopRankingBarChart
						data={modelData}
						categoryKey="key"
						valueKey="spend"
						yAxisWidth={200}
						height={52}
						valueFormatter={valueFormatterSpend}
						renderTooltip={(data) =>
							data && (
								<div className="bg-white p-4 shadow-lg rounded-lg border">
									<p className="font-bold">{data.key}</p>
									<p className="text-cyan-500">Spend: ${formatNumberWithCommas(data.spend, 2)}</p>
									<p className="text-gray-600">Total Requests: {data.requests.toLocaleString()}</p>
									<p className="text-green-600">Successful: {data.successful_requests.toLocaleString()}</p>
									<p className="text-red-600">Failed: {data.failed_requests.toLocaleString()}</p>
									<p className="text-gray-600">Tokens: {formatNumberWithCommas(data.tokens, 0, false)}</p>
								</div>
							)
						}
					/>
				</div>
			)}
		</Card>
	);
}
