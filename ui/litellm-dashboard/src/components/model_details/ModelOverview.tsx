import { Text } from "@tremor/react";
import { Tooltip } from "antd";
import { ProviderLogo } from "../molecules/models/ProviderLogo";

interface ModelOverviewProps {
	modelData: any;
}

function ModelAuditInfo({ modelInfo }: { modelInfo: any }) {
	const createdAt = modelInfo.created_at
		? new Date(modelInfo.created_at).toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
			})
		: "-";

	return (
		<div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
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
				Created By {modelInfo.created_by || "-"}
			</div>
		</div>
	);
}

export default function ModelOverview({ modelData }: ModelOverviewProps) {
	const overviewItems = [
		{
			label: "Provider",
			value: modelData.provider,
			render: modelData.provider ? (
				<div className="flex items-center gap-2">
					<ProviderLogo provider={modelData.provider} modelName={modelData.litellm_model_name} />
					<span>{modelData.provider}</span>
				</div>
			) : null,
		},
		{ label: "LiteLLM Model", value: modelData.litellm_model_name },
		{ label: "Input / 1M", value: modelData.input_cost != null ? `$${modelData.input_cost}` : null },
		{ label: "Output / 1M", value: modelData.output_cost != null ? `$${modelData.output_cost}` : null },
	];
	return (
		<div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
			<div className="grid grid-cols-2 lg:grid-cols-4">
				{overviewItems.map((item) => (
					<div key={item.label} className="min-w-0 border-r border-gray-100 px-3 py-2 last:border-r-0">
						<Text className="text-[11px] uppercase tracking-wide text-gray-400">{item.label}</Text>
						<Tooltip title={item.value || "-"}>
							<div className={`mt-0.5 truncate text-sm font-medium ${item.value ? "text-gray-800" : "text-gray-300"}`}>
								{item.render ?? item.value ?? "-"}
							</div>
						</Tooltip>
					</div>
				))}
			</div>
			<ModelAuditInfo modelInfo={modelData.model_info} />
		</div>
	);
}
