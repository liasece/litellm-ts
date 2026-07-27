import { Badge, Text } from "@tremor/react";
import type { ToolPermissionConfig } from "../tool_permission/ToolPermissionRulesEditor";
import ToolPermissionRulesEditor from "../tool_permission/ToolPermissionRulesEditor";

interface GuardrailSettingsSummaryProps {
	guardrailData: any;
	displayName: string;
	toolPermissionConfig: ToolPermissionConfig;
}

const formatDate = (dateString?: string) => (dateString ? new Date(dateString).toLocaleString() : "-");

function GuardrailSetting({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<Text className="font-medium">{label}</Text>
			{children}
		</div>
	);
}

export default function GuardrailSettingsSummary({
	guardrailData,
	displayName,
	toolPermissionConfig,
}: GuardrailSettingsSummaryProps) {
	const piiConfig = guardrailData.litellm_params?.pii_entities_config;

	return (
		<div className="space-y-4">
			<GuardrailSetting label="Guardrail ID">
				<div className="font-mono">{guardrailData.guardrail_id}</div>
			</GuardrailSetting>
			<GuardrailSetting label="Guardrail Name">
				<div>{guardrailData.guardrail_name || "Unnamed Guardrail"}</div>
			</GuardrailSetting>
			<GuardrailSetting label="Provider">
				<div>{displayName}</div>
			</GuardrailSetting>
			<GuardrailSetting label="Mode">
				<div>{guardrailData.litellm_params?.mode || "-"}</div>
			</GuardrailSetting>
			<GuardrailSetting label="Default On">
				<Badge color={guardrailData.litellm_params?.default_on ? "green" : "gray"}>
					{guardrailData.litellm_params?.default_on ? "Yes" : "No"}
				</Badge>
			</GuardrailSetting>
			{piiConfig && Object.keys(piiConfig).length > 0 && (
				<GuardrailSetting label="PII Protection">
					<div className="mt-2">
						<Badge color="blue">{Object.keys(piiConfig).length} PII entities configured</Badge>
					</div>
				</GuardrailSetting>
			)}
			<GuardrailSetting label="Created At">
				<div>{formatDate(guardrailData.created_at)}</div>
			</GuardrailSetting>
			<GuardrailSetting label="Last Updated">
				<div>{formatDate(guardrailData.updated_at)}</div>
			</GuardrailSetting>
			{guardrailData.litellm_params?.guardrail === "tool_permission" && (
				<ToolPermissionRulesEditor value={toolPermissionConfig} disabled />
			)}
		</div>
	);
}
