import { DownOutlined, InfoCircleOutlined, RightOutlined } from "@ant-design/icons";
import { Card, Text, Title } from "@tremor/react";
import { Tooltip } from "antd";
import { formatNumberWithCommas } from "@/utils/dataUtils";

export interface UsageSummaryMetadata {
	total_api_requests?: number;
	total_successful_requests?: number;
	total_failed_requests?: number;
	total_tokens?: number;
	total_prompt_tokens?: number;
	total_completion_tokens?: number;
	total_cache_read_input_tokens?: number;
	total_cache_creation_input_tokens?: number;
}

interface UsageMetricsCardsProps {
	metadata?: UsageSummaryMetadata;
	totalSpend: number;
	maxBudget: number | null;
	dateRangeLabel: string;
	showTokenBreakdown: boolean;
	onToggleTokenBreakdown: () => void;
}

interface MetricTileProps {
	label: string;
	value: string;
	valueClassName?: string;
	tooltip?: string;
}

function MetricTile({ label, value, valueClassName = "text-slate-950", tooltip }: MetricTileProps) {
	return (
		<div className="min-w-0 px-4 py-3">
			<div className="flex items-center gap-1.5">
				<Text className="!text-xs !font-medium !text-slate-500">{label}</Text>
				{tooltip && (
					<Tooltip title={tooltip}>
						<InfoCircleOutlined className="text-[11px] text-slate-400" />
					</Tooltip>
				)}
			</div>
			<div className={`mt-1 truncate text-xl font-semibold tabular-nums ${valueClassName}`} title={value}>
				{value}
			</div>
		</div>
	);
}

export default function UsageMetricsCards({
	metadata,
	totalSpend,
	maxBudget,
	dateRangeLabel,
	showTokenBreakdown,
	onToggleTokenBreakdown,
}: UsageMetricsCardsProps) {
	const totalRequests = metadata?.total_api_requests ?? 0;
	const successfulRequests = metadata?.total_successful_requests ?? 0;
	const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0;

	return (
		<Card className="!p-0 overflow-hidden">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
				<Title>Usage Metrics</Title>
				<Text className="!text-xs !text-slate-500">{dateRangeLabel}</Text>
			</div>
			<div className="grid grid-cols-2 divide-x divide-y divide-slate-200 sm:grid-cols-4 xl:grid-cols-7 xl:divide-y-0">
				<MetricTile label="Total Spend" value={`$${formatNumberWithCommas(totalSpend, 4)}`} />
				<MetricTile
					label="Max Budget"
					value={maxBudget === null ? "No limit" : `$${formatNumberWithCommas(maxBudget, 4)}`}
				/>
				<MetricTile label="Total Requests" value={totalRequests.toLocaleString()} />
				<MetricTile
					label="Successful Requests"
					value={successfulRequests.toLocaleString()}
					valueClassName="text-emerald-600"
					tooltip={`${formatNumberWithCommas(successRate, 1)}% success rate`}
				/>
				<MetricTile
					label="Failed Requests"
					value={(metadata?.total_failed_requests ?? 0).toLocaleString()}
					valueClassName="text-rose-600"
					tooltip="Includes routing, tool usage, and other request failures where a provider may not be available."
				/>
				<MetricTile
					label="Avg. Cost / Request"
					value={`$${formatNumberWithCommas(totalSpend / (totalRequests || 1), 4)}`}
				/>
				<button
					type="button"
					className="min-w-0 px-4 py-3 text-left transition-colors hover:bg-slate-50"
					onClick={onToggleTokenBreakdown}
					aria-expanded={showTokenBreakdown}
				>
					<div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
						Total Tokens
						{showTokenBreakdown ? (
							<DownOutlined className="text-[10px] text-slate-400" />
						) : (
							<RightOutlined className="text-[10px] text-slate-400" />
						)}
					</div>
					<div className="mt-1 truncate text-xl font-semibold tabular-nums text-slate-950">
						{formatNumberWithCommas(metadata?.total_tokens ?? 0, 0, false)}
					</div>
				</button>
			</div>
			{showTokenBreakdown && (
				<div className="grid grid-cols-2 border-t border-slate-200 bg-slate-50/70 sm:grid-cols-4">
					<MetricTile
						label="Input Tokens"
						value={formatNumberWithCommas(metadata?.total_prompt_tokens ?? 0, 0, false)}
						valueClassName="text-blue-600"
					/>
					<MetricTile
						label="Output Tokens"
						value={formatNumberWithCommas(metadata?.total_completion_tokens ?? 0, 0, false)}
						valueClassName="text-cyan-600"
					/>
					<MetricTile
						label="Cache Read"
						value={formatNumberWithCommas(metadata?.total_cache_read_input_tokens ?? 0, 0, false)}
						valueClassName="text-emerald-600"
					/>
					<MetricTile
						label="Cache Write"
						value={formatNumberWithCommas(metadata?.total_cache_creation_input_tokens ?? 0, 0, false)}
						valueClassName="text-violet-600"
					/>
				</div>
			)}
		</Card>
	);
}
