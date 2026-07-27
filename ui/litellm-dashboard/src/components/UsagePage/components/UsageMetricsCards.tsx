import { DownOutlined, InfoCircleOutlined, RightOutlined } from "@ant-design/icons";
import { Card, Grid, Text, Title } from "@tremor/react";
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
	showTokenBreakdown: boolean;
	onToggleTokenBreakdown: () => void;
}

export default function UsageMetricsCards({
	metadata,
	totalSpend,
	showTokenBreakdown,
	onToggleTokenBreakdown,
}: UsageMetricsCardsProps) {
	return (
		<Card>
			<Title>Usage Metrics</Title>
			<Grid numItems={5} className="gap-4 mt-4">
				<Card>
					<Title>Total Requests</Title>
					<Text className="text-2xl font-bold mt-2">{metadata?.total_api_requests?.toLocaleString() || 0}</Text>
				</Card>
				<Card>
					<Title>Successful Requests</Title>
					<Text className="text-2xl font-bold mt-2 text-green-600">
						{metadata?.total_successful_requests?.toLocaleString() || 0}
					</Text>
				</Card>
				<Card>
					<div className="flex items-center gap-2">
						<Title>Failed Requests</Title>
						<Tooltip title="Includes requests that failed to route to a provider, tool usage failures, and other request errors where the provider cannot be determined.">
							<InfoCircleOutlined className="text-gray-400 hover:text-gray-600" />
						</Tooltip>
					</div>
					<Text className="text-2xl font-bold mt-2 text-red-600">
						{metadata?.total_failed_requests?.toLocaleString() || 0}
					</Text>
				</Card>
				<Card>
					<Title>Average Cost per Request</Title>
					<Text className="text-2xl font-bold mt-2">
						${formatNumberWithCommas(totalSpend / (metadata?.total_api_requests || 1), 4)}
					</Text>
				</Card>
				<Card className="cursor-pointer hover:bg-gray-50 transition-colors" onClick={onToggleTokenBreakdown}>
					<div className="flex items-center gap-2">
						<Title>Total Tokens</Title>
						{showTokenBreakdown ? (
							<DownOutlined className="text-gray-400 text-xs" />
						) : (
							<RightOutlined className="text-gray-400 text-xs" />
						)}
					</div>
					<Text className="text-2xl font-bold mt-2">
						{formatNumberWithCommas(metadata?.total_tokens ?? 0, 0, false)}
					</Text>
				</Card>
			</Grid>
			{showTokenBreakdown && (
				<Grid numItems={4} className="gap-4 mt-4">
					<Card>
						<Title>Input Tokens</Title>
						<Text className="text-2xl font-bold mt-2 text-blue-600">
							{formatNumberWithCommas(metadata?.total_prompt_tokens ?? 0, 0, false)}
						</Text>
					</Card>
					<Card>
						<Title>Output Tokens</Title>
						<Text className="text-2xl font-bold mt-2 text-cyan-600">
							{formatNumberWithCommas(metadata?.total_completion_tokens ?? 0, 0, false)}
						</Text>
					</Card>
					<Card>
						<Title>Cache Read Tokens</Title>
						<Text className="text-2xl font-bold mt-2 text-green-600">
							{formatNumberWithCommas(metadata?.total_cache_read_input_tokens ?? 0, 0, false)}
						</Text>
					</Card>
					<Card>
						<Title>Cache Write Tokens</Title>
						<Text className="text-2xl font-bold mt-2 text-purple-600">
							{formatNumberWithCommas(metadata?.total_cache_creation_input_tokens ?? 0, 0, false)}
						</Text>
					</Card>
				</Grid>
			)}
		</Card>
	);
}
