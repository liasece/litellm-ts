import { formatNumberWithCommas } from "@/utils/dataUtils";
import { InfoCircleOutlined } from "@ant-design/icons";
import { Badge, Text } from "@tremor/react";
import { Tooltip } from "antd";
import type { ReactNode } from "react";
import LoggingSettingsView from "../../logging_settings_view";
import ObjectPermissionsView from "../../object_permissions_view";
import type { TeamData } from "../types";

interface TeamSettingsSummaryProps {
	info: TeamData["team_info"];
	accessToken: string | null;
}

function SettingValue({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div>
			<Text className="font-medium">{label}</Text>
			<div>{children}</div>
		</div>
	);
}

export default function TeamSettingsSummary({ info, accessToken }: TeamSettingsSummaryProps) {
	return (
		<div className="space-y-4">
			<SettingValue label="Team Name">{info.team_alias}</SettingValue>
			<SettingValue label="Team ID">
				<span className="font-mono">{info.team_id}</span>
			</SettingValue>
			<SettingValue label="Created At">{new Date(info.created_at).toLocaleString()}</SettingValue>
			<SettingValue label="Models">
				<div className="mt-1 flex flex-wrap gap-2">
					{info.models.map((model) => (
						<Badge key={model} color="red">
							{model}
						</Badge>
					))}
				</div>
			</SettingValue>
			<SettingValue label="Rate Limits">
				<div>TPM: {info.tpm_limit || "Unlimited"}</div>
				<div>RPM: {info.rpm_limit || "Unlimited"}</div>
			</SettingValue>
			<SettingValue label="Team Budget">
				<div>
					Max Budget: {info.max_budget !== null ? `$${formatNumberWithCommas(info.max_budget, 4)}` : "No Limit"}
				</div>
				<div>
					Soft Budget:{" "}
					{info.soft_budget !== null && info.soft_budget !== undefined
						? `$${formatNumberWithCommas(info.soft_budget, 4)}`
						: "No Limit"}
				</div>
				<div>Budget Reset: {info.budget_duration || "Never"}</div>
				{Array.isArray(info.metadata?.soft_budget_alerting_emails) &&
					info.metadata.soft_budget_alerting_emails.length > 0 && (
						<div>Soft Budget Alerting Emails: {info.metadata.soft_budget_alerting_emails.join(", ")}</div>
					)}
			</SettingValue>
			<div>
				<Text className="font-medium">
					Team Member Settings{" "}
					<Tooltip title="These are limits on individual team members">
						<InfoCircleOutlined style={{ marginLeft: 4 }} />
					</Tooltip>
				</Text>
				<div>Max Budget: {info.team_member_budget_table?.max_budget || "No Limit"}</div>
				<div>Budget Duration: {info.team_member_budget_table?.budget_duration || "No Limit"}</div>
				<div>Key Duration: {info.metadata?.team_member_key_duration || "No Limit"}</div>
				<div>TPM Limit: {info.team_member_budget_table?.tpm_limit || "No Limit"}</div>
				<div>RPM Limit: {info.team_member_budget_table?.rpm_limit || "No Limit"}</div>
			</div>
			<SettingValue label="Organization ID">{info.organization_id}</SettingValue>
			<SettingValue label="Status">
				<Badge color={info.blocked ? "red" : "green"}>{info.blocked ? "Blocked" : "Active"}</Badge>
			</SettingValue>
			<SettingValue label="Disable Global Guardrails">
				{info.metadata?.disable_global_guardrails === true ? (
					<Badge color="yellow">Enabled - Global guardrails bypassed</Badge>
				) : (
					<Badge color="green">Disabled - Global guardrails active</Badge>
				)}
			</SettingValue>
			<ObjectPermissionsView
				objectPermission={info.object_permission}
				variant="inline"
				className="border-t border-gray-200 pt-4"
				accessToken={accessToken}
			/>
			<LoggingSettingsView
				loggingConfigs={info.metadata?.logging || []}
				disabledCallbacks={[]}
				variant="inline"
				className="border-t border-gray-200 pt-4"
			/>
			{info.metadata?.secret_manager_settings && (
				<div className="border-t border-gray-200 pt-4">
					<Text className="font-medium">Secret Manager Settings</Text>
					<pre className="mt-2 overflow-x-auto rounded bg-gray-50 p-3 text-xs">
						{JSON.stringify(info.metadata.secret_manager_settings, null, 2)}
					</pre>
				</div>
			)}
		</div>
	);
}
