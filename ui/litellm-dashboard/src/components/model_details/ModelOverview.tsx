import { Card, Grid, Text, Title } from "@tremor/react";
import { Tooltip } from "antd";
import { useState } from "react";
import { getProviderLogoAndName } from "../provider_info_helpers";

interface ModelOverviewProps {
	modelData: any;
}

function ProviderLogo({ provider }: { provider: string }) {
	const [failed, setFailed] = useState(false);

	if (failed) {
		return (
			<div className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-xs" aria-hidden="true">
				{provider.charAt(0) || "-"}
			</div>
		);
	}

	return (
		<img
			src={getProviderLogoAndName(provider).logo}
			alt={`${provider} logo`}
			className="h-4 w-4"
			onError={() => setFailed(true)}
		/>
	);
}

function ModelAuditInfo({ modelInfo }: { modelInfo: any }) {
	const createdAt = modelInfo.created_at
		? new Date(modelInfo.created_at).toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
			})
		: "Not Set";

	return (
		<div className="mb-6 flex items-center gap-x-6 text-sm text-gray-500">
			<div className="flex items-center gap-x-2">
				<svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth="2"
						d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
				Created At {createdAt}
			</div>
			<div className="flex items-center gap-x-2">
				<svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth="2"
						d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
					/>
				</svg>
				Created By {modelInfo.created_by || "Not Set"}
			</div>
		</div>
	);
}

export default function ModelOverview({ modelData }: ModelOverviewProps) {
	return (
		<>
			<Grid numItems={1} numItemsSm={2} numItemsLg={3} className="mb-6 gap-6">
				<Card>
					<Text>Provider</Text>
					<div className="mt-2 flex items-center space-x-2">
						{modelData.provider && <ProviderLogo provider={modelData.provider} />}
						<Title>{modelData.provider || "Not Set"}</Title>
					</div>
				</Card>
				<Card>
					<Text>LiteLLM Model</Text>
					<div className="mt-2 overflow-hidden">
						<Tooltip title={modelData.litellm_model_name || "Not Set"}>
							<div className="cursor-pointer break-all text-sm font-medium leading-relaxed">
								{modelData.litellm_model_name || "Not Set"}
							</div>
						</Tooltip>
					</div>
				</Card>
				<Card>
					<Text>Pricing</Text>
					<div className="mt-2">
						<Text>Input: ${modelData.input_cost}/1M tokens</Text>
						<Text>Output: ${modelData.output_cost}/1M tokens</Text>
					</div>
				</Card>
			</Grid>
			<ModelAuditInfo modelInfo={modelData.model_info} />
		</>
	);
}
