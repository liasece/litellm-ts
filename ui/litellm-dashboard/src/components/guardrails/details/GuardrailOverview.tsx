import { CodeOutlined, EyeInvisibleOutlined, StopOutlined } from "@ant-design/icons";
import { Badge, Card, Grid, Text, Title } from "@tremor/react";
import { Button } from "antd";
import { useState } from "react";
import ContentFilterManager from "../content_filter/ContentFilterManager";
import type { ToolPermissionConfig } from "../tool_permission/ToolPermissionRulesEditor";
import ToolPermissionRulesEditor from "../tool_permission/ToolPermissionRulesEditor";

interface GuardrailOverviewProps {
	guardrailData: any;
	guardrailSettings: any;
	toolPermissionConfig: ToolPermissionConfig;
	accessToken: string | null;
	isAdmin: boolean;
	isConfigGuardrail: boolean;
	logo: string | null | undefined;
	displayName: string;
	onEditCode: () => void;
}

const formatDate = (dateString?: string) => (dateString ? new Date(dateString).toLocaleString() : "-");

export default function GuardrailOverview({
	guardrailData,
	guardrailSettings,
	toolPermissionConfig,
	accessToken,
	isAdmin,
	isConfigGuardrail,
	logo,
	displayName,
	onEditCode,
}: GuardrailOverviewProps) {
	const [logoVisible, setLogoVisible] = useState(true);
	const piiConfig = guardrailData.litellm_params?.pii_entities_config;
	const hasPiiConfig = piiConfig && Object.keys(piiConfig).length > 0;

	return (
		<>
			<Grid numItems={1} numItemsSm={2} numItemsLg={3} className="gap-6">
				<Card>
					<Text>Provider</Text>
					<div className="mt-2 flex items-center space-x-2">
						{logo && logoVisible && (
							<img
								src={logo}
								alt={`${displayName} logo`}
								className="h-6 w-6"
								onError={() => setLogoVisible(false)}
							/>
						)}
						<Title>{displayName}</Title>
					</div>
				</Card>
				<Card>
					<Text>Mode</Text>
					<div className="mt-2">
						<Title>{guardrailData.litellm_params?.mode || "-"}</Title>
						<Badge color={guardrailData.litellm_params?.default_on ? "green" : "gray"}>
							{guardrailData.litellm_params?.default_on ? "Default On" : "Default Off"}
						</Badge>
					</div>
				</Card>
				<Card>
					<Text>Created At</Text>
					<div className="mt-2">
						<Title>{formatDate(guardrailData.created_at)}</Title>
						<Text>Last Updated: {formatDate(guardrailData.updated_at)}</Text>
					</div>
				</Card>
			</Grid>

			{hasPiiConfig && (
				<Card className="mt-6">
					<div className="flex items-center justify-between">
						<Text className="font-medium">PII Protection</Text>
						<Badge color="blue">{Object.keys(piiConfig).length} PII entities configured</Badge>
					</div>
				</Card>
			)}

			{hasPiiConfig && (
				<Card className="mt-6">
					<Text className="mb-4 text-lg font-semibold">PII Entity Configuration</Text>
					<div className="overflow-hidden rounded-lg border shadow-sm">
						<div className="flex border-b bg-gray-50 px-5 py-3">
							<Text className="flex-1 font-semibold text-gray-700">Entity Type</Text>
							<Text className="flex-1 font-semibold text-gray-700">Configuration</Text>
						</div>
						<div className="max-h-[400px] overflow-y-auto">
							{Object.entries(piiConfig).map(([entity, action]) => (
								<div
									key={entity}
									className="flex border-b px-5 py-3 transition-colors hover:bg-gray-50"
								>
									<Text className="flex-1 font-medium text-gray-900">{entity}</Text>
									<Text className="flex-1">
										<span
											className={`inline-flex items-center gap-1.5 ${
												action === "MASK" ? "text-blue-600" : "text-red-600"
											}`}
										>
											{action === "MASK" ? <EyeInvisibleOutlined /> : <StopOutlined />}
											{String(action)}
										</span>
									</Text>
								</div>
							))}
						</div>
					</div>
				</Card>
			)}

			{guardrailData.litellm_params?.guardrail === "tool_permission" && (
				<Card className="mt-6">
					<ToolPermissionRulesEditor value={toolPermissionConfig} disabled />
				</Card>
			)}

			{guardrailData.litellm_params?.guardrail === "custom_code" &&
				guardrailData.litellm_params?.custom_code && (
					<Card className="mt-6">
						<div className="mb-4 flex items-center justify-between">
							<div className="flex items-center gap-2">
								<CodeOutlined className="text-blue-500" />
								<Text className="text-lg font-medium">Custom Code</Text>
							</div>
							{isAdmin && !isConfigGuardrail && (
								<Button size="small" icon={<CodeOutlined />} onClick={onEditCode}>
									Edit Code
								</Button>
							)}
						</div>
						<div className="relative overflow-hidden rounded-lg border border-gray-700 bg-[#1e1e1e]">
							<pre
								className="overflow-x-auto p-4 text-sm text-gray-200"
								style={{ fontFamily: "'Fira Code', 'Monaco', 'Consolas', monospace" }}
							>
								<code>{guardrailData.litellm_params.custom_code}</code>
							</pre>
						</div>
					</Card>
				)}

			<ContentFilterManager
				guardrailData={guardrailData}
				guardrailSettings={guardrailSettings}
				isEditing={false}
				accessToken={accessToken}
			/>
		</>
	);
}
