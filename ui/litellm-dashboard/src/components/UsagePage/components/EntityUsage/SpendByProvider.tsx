import { formatNumberWithCommas } from "@/utils/dataUtils";
import { InfoCircleOutlined } from "@ant-design/icons";
import { Card, Switch, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Title } from "@tremor/react";
import { Tooltip } from "antd";
import React, { useState } from "react";
import { ProviderLogo } from "../../../molecules/models/ProviderLogo";
import { ChartLoader } from "../../../shared/chart_loader";

interface ProviderSpendData {
	provider: string;
	spend: number;
	requests: number;
	successful_requests: number;
	failed_requests: number;
	tokens: number;
}

interface SpendByProviderProps {
	loading: boolean;
	isDateChanging: boolean;
	providerSpend: ProviderSpendData[];
}

const SpendByProvider: React.FC<SpendByProviderProps> = ({ loading, isDateChanging, providerSpend }) => {
	const [includeZeroSpend, setIncludeZeroSpend] = useState(false);
	const [includeUnknown, setIncludeUnknown] = useState(false);

	const filteredProviderSpend = providerSpend
		.filter((provider) => {
			const isUnknown = provider.provider?.toLowerCase() === "unknown";

			// If includeUnknown is true, always include unknown provider
			if (isUnknown) {
				return includeUnknown;
			}

			// If includeZeroSpend is true, include all providers (including those with 0 spend)
			// Otherwise, only include providers with spend > 0
			if (includeZeroSpend) {
				return true;
			}

			return provider.spend > 0;
		})
		.sort((a, b) => b.spend - a.spend);
	const maxSpend = filteredProviderSpend[0]?.spend ?? 0;

	return (
		<Card className="h-full !p-4">
			<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
				<Title>Spend by Provider</Title>
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-2">
						<label className="text-xs text-slate-600">Show Zero Spend</label>
						<Switch checked={includeZeroSpend} onChange={setIncludeZeroSpend} />
					</div>
					<div className="flex items-center gap-2">
						<div className="flex items-center gap-1">
							<label className="text-xs text-slate-600">Show Unknown</label>
							<Tooltip title="Requests that failed to route to a provider">
								<InfoCircleOutlined className="text-[11px] text-slate-400" />
							</Tooltip>
						</div>
						<Switch checked={includeUnknown} onChange={setIncludeUnknown} />
					</div>
				</div>
			</div>
			{loading ? (
				<ChartLoader isDateChanging={isDateChanging} />
			) : (
				<div className="max-h-[320px] overflow-auto">
					<Table className="[&_td]:py-2 [&_th]:py-2">
						<TableHead>
							<TableRow>
								<TableHeaderCell>Provider</TableHeaderCell>
								<TableHeaderCell>Spend</TableHeaderCell>
								<TableHeaderCell>Requests</TableHeaderCell>
								<TableHeaderCell className="text-green-600">Successful</TableHeaderCell>
								<TableHeaderCell className="text-red-600">Failed</TableHeaderCell>
								<TableHeaderCell>Tokens</TableHeaderCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{filteredProviderSpend.map((provider) => (
								<TableRow key={provider.provider}>
									<TableCell>
										<div className="flex items-center space-x-2">
											{provider.provider && <ProviderLogo provider={provider.provider} className="w-4 h-4" />}
											<span>{provider.provider}</span>
										</div>
									</TableCell>
									<TableCell>
										<div className="min-w-24">
											<div className="tabular-nums">${formatNumberWithCommas(provider.spend, 2)}</div>
											<div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100">
												<div
													className="h-full rounded-full bg-cyan-500"
													style={{ width: `${maxSpend > 0 ? Math.max(2, (provider.spend / maxSpend) * 100) : 0}%` }}
												/>
											</div>
										</div>
									</TableCell>
									<TableCell>{provider.requests.toLocaleString()}</TableCell>
									<TableCell className="text-green-600">{provider.successful_requests.toLocaleString()}</TableCell>
									<TableCell className="text-red-600">{provider.failed_requests.toLocaleString()}</TableCell>
									<TableCell>{formatNumberWithCommas(provider.tokens, 0, false)}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</Card>
	);
};

export default SpendByProvider;
