import type { ProjectResponse } from "@/app/(dashboard)/hooks/projects/useProjects";
import { formatNumberWithCommas } from "@/utils/dataUtils";
import { Badge, Card, Text, Title } from "@tremor/react";
import { Tag } from "antd";
import { mapInternalToDisplayNames } from "../callback_info_helpers";
import AutoRotationView from "../common_components/AutoRotationView";
import { extractLoggingSettings, formatMetadataForDisplay, stripTagsFromMetadata } from "../key_info_utils";
import type { KeyResponse } from "../key_team_helpers/key_list";
import LoggingSettingsView from "../logging_settings_view";
import ObjectPermissionsView from "../object_permissions_view";
import { formatKeyTimestamp } from "./formatKeyTimestamp";
import KeyValueList, { EmptyKeyValueList } from "./KeyValueList";

interface KeySettingsSummaryProps {
	keyData: KeyResponse;
	accessToken: string | null;
	projects: ProjectResponse[] | undefined;
	enableProjectsUI: boolean;
	lastRegeneratedAt: Date | null;
	recentlyRegenerated: boolean;
}

function KeySetting({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<Text className="font-medium">{label}</Text>
			{children}
		</div>
	);
}

export default function KeySettingsSummary({
	keyData,
	accessToken,
	projects,
	enableProjectsUI,
	lastRegeneratedAt,
	recentlyRegenerated,
}: KeySettingsSummaryProps) {
	const project = projects?.find((item) => item.project_id === keyData.project_id);
	const projectLabel = keyData.project_id
		? project?.project_alias
			? `${project.project_alias} (${keyData.project_id})`
			: keyData.project_id
		: "Not Set";

	return (
		<Card className="max-h-[65vh] overflow-y-auto">
			<Title className="mb-4">Key Settings</Title>
			<div className="space-y-4">
				<KeySetting label="Key ID">
					<Text className="font-mono">{keyData.token_id || keyData.token}</Text>
				</KeySetting>
				<KeySetting label="Key Alias">
					<Text>{keyData.key_alias || "Not Set"}</Text>
				</KeySetting>
				<KeySetting label="Secret Key">
					<Text className="font-mono">{keyData.key_name}</Text>
				</KeySetting>
				<KeySetting label="Team ID">
					<Text>{keyData.team_id || "Not Set"}</Text>
				</KeySetting>
				{enableProjectsUI && (
					<KeySetting label="Project">
						<Text>{projectLabel}</Text>
					</KeySetting>
				)}
				<KeySetting label="Organization">
					<Text>{(keyData.organization_id ?? keyData.org_id) || "Not Set"}</Text>
				</KeySetting>
				<KeySetting label="Created">
					<Text>{formatKeyTimestamp(keyData.created_at)}</Text>
				</KeySetting>
				{lastRegeneratedAt && (
					<KeySetting label="Last Regenerated">
						<div className="flex items-center gap-2">
							<Text>{formatKeyTimestamp(lastRegeneratedAt)}</Text>
							{recentlyRegenerated && (
								<Badge color="green" size="xs">
									Recent
								</Badge>
							)}
						</div>
					</KeySetting>
				)}
				<KeySetting label="Expires">
					<Text>{keyData.expires ? formatKeyTimestamp(keyData.expires) : "Never"}</Text>
				</KeySetting>

				<AutoRotationView
					autoRotate={keyData.auto_rotate}
					rotationInterval={keyData.rotation_interval}
					lastRotationAt={keyData.last_rotation_at}
					keyRotationAt={keyData.key_rotation_at}
					nextRotationAt={keyData.next_rotation_at}
					variant="inline"
					className="border-t border-gray-200 pt-4"
				/>

				<KeySetting label="Spend">
					<Text>${formatNumberWithCommas(keyData.spend, 4)} USD</Text>
				</KeySetting>
				<KeySetting label="Budget">
					<Text>{keyData.max_budget !== null ? `$${formatNumberWithCommas(keyData.max_budget, 2)}` : "Unlimited"}</Text>
				</KeySetting>
				<KeySetting label="Tags">
					<KeyValueList values={keyData.metadata?.tags} empty="No tags specified" />
				</KeySetting>
				<KeySetting label="Prompts">
					<KeyValueList values={keyData.metadata?.prompts} empty="No prompts specified" />
				</KeySetting>
				<KeySetting label="Allowed Routes">
					<KeyValueList values={keyData.allowed_routes} empty={<Tag color="green">All routes allowed</Tag>} />
				</KeySetting>
				<KeySetting label="Allowed Pass Through Routes">
					<KeyValueList
						values={keyData.metadata?.allowed_passthrough_routes}
						empty="No pass through routes specified"
					/>
				</KeySetting>
				<KeySetting label="Disable Global Guardrails">
					{keyData.metadata?.disable_global_guardrails === true ? (
						<Badge color="yellow">Enabled - Global guardrails bypassed</Badge>
					) : (
						<Badge color="green">Disabled - Global guardrails active</Badge>
					)}
				</KeySetting>
				<KeySetting label="Models">
					<KeyValueList values={keyData.models} empty={<EmptyKeyValueList>No models specified</EmptyKeyValueList>} />
				</KeySetting>
				<KeySetting label="Rate Limits">
					<Text>TPM: {keyData.tpm_limit !== null ? keyData.tpm_limit : "Unlimited"}</Text>
					<Text>RPM: {keyData.rpm_limit !== null ? keyData.rpm_limit : "Unlimited"}</Text>
					<Text>
						Max Parallel Requests:{" "}
						{keyData.max_parallel_requests !== null ? keyData.max_parallel_requests : "Unlimited"}
					</Text>
					<Text>
						Model TPM Limits:{" "}
						{keyData.metadata?.model_tpm_limit ? JSON.stringify(keyData.metadata.model_tpm_limit) : "Unlimited"}
					</Text>
					<Text>
						Model RPM Limits:{" "}
						{keyData.metadata?.model_rpm_limit ? JSON.stringify(keyData.metadata.model_rpm_limit) : "Unlimited"}
					</Text>
				</KeySetting>
				<KeySetting label="Metadata">
					<pre className="mt-1 overflow-auto rounded bg-gray-100 p-2 text-xs">
						{formatMetadataForDisplay(stripTagsFromMetadata(keyData.metadata))}
					</pre>
				</KeySetting>

				<ObjectPermissionsView
					objectPermission={keyData.object_permission}
					variant="inline"
					className="border-t border-gray-200 pt-4"
					accessToken={accessToken}
				/>
				<LoggingSettingsView
					loggingConfigs={extractLoggingSettings(keyData.metadata)}
					disabledCallbacks={
						Array.isArray(keyData.metadata?.litellm_disabled_callbacks)
							? mapInternalToDisplayNames(keyData.metadata.litellm_disabled_callbacks)
							: []
					}
					variant="inline"
					className="border-t border-gray-200 pt-4"
				/>
			</div>
		</Card>
	);
}
