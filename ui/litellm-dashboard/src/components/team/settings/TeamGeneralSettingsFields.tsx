import { isProxyAdminRole } from "@/utils/roles";
import { TextInput } from "@tremor/react";
import { Form, Input, Select, type FormInstance } from "antd";
import DurationSelect from "../../common_components/DurationSelect";
import { ModelSelect } from "../../ModelSelect/ModelSelect";
import NumericalInput from "../../shared/numerical_input";
import type { TeamData } from "../types";

interface TeamGeneralSettingsFieldsProps {
	form: FormInstance;
	teamId?: string;
	info?: TeamData["team_info"];
	userRole: string | null;
	organizationId?: string | null;
	mode?: "create" | "edit";
	showTeamName?: boolean;
}

export default function TeamGeneralSettingsFields({
	form,
	teamId,
	info,
	userRole,
	organizationId,
	mode = "edit",
	showTeamName = true,
}: TeamGeneralSettingsFieldsProps) {
	const resolvedOrganizationId = organizationId ?? info?.organization_id;

	return (
		<>
			{showTeamName && (
				<Form.Item
					label="Team Name"
					name="team_alias"
					rules={[{ required: true, message: "Please input a team name" }]}
				>
					<Input />
				</Form.Item>
			)}
			<Form.Item label="Models" name="models" rules={[{ required: true, message: "Please select at least one model" }]}>
				<ModelSelect
					value={form.getFieldValue("models") || []}
					onChange={(values) => form.setFieldValue("models", values)}
					teamID={teamId}
					organizationID={resolvedOrganizationId || undefined}
					options={{
						includeSpecialOptions: true,
						includeUserModels: !resolvedOrganizationId,
						showAllProxyModelsOverride:
							mode === "create" ? !resolvedOrganizationId : isProxyAdminRole(userRole || "") && !resolvedOrganizationId,
					}}
					context="team"
					dataTestId={mode === "create" ? "create-team-models-select" : "models-select"}
				/>
			</Form.Item>
			<Form.Item label="Max Budget (USD)" name="max_budget">
				<NumericalInput step={0.01} precision={2} style={{ width: "100%" }} />
			</Form.Item>
			{mode === "edit" && (
				<>
					<Form.Item label="Soft Budget (USD)" name="soft_budget">
						<NumericalInput step={0.01} precision={2} style={{ width: "100%" }} />
					</Form.Item>
					<Form.Item
						label="Soft Budget Alerting Emails"
						name="soft_budget_alerting_emails"
						tooltip="Comma-separated email addresses to receive alerts when the soft budget is reached"
					>
						<Input placeholder="example1@test.com, example2@test.com" />
					</Form.Item>
				</>
			)}
			<Form.Item
				label="Team Member Budget (USD)"
				name="team_member_budget"
				tooltip="This is the individual budget for a user in the team."
			>
				<NumericalInput step={0.01} precision={2} style={{ width: "100%" }} />
			</Form.Item>
			{mode === "edit" && (
				<Form.Item label="Team Member Budget Duration" name="team_member_budget_duration">
					<DurationSelect
						onChange={(value) => form.setFieldValue("team_member_budget_duration", value)}
						value={form.getFieldValue("team_member_budget_duration")}
					/>
				</Form.Item>
			)}
			<Form.Item
				label="Team Member Key Duration (eg: 1d, 1mo)"
				name="team_member_key_duration"
				tooltip="Set a limit to the duration of a team member's key. Format: 30s (seconds), 30m (minutes), 30h (hours), 30d (days), 1mo (month)"
			>
				<TextInput placeholder="e.g., 30d" />
			</Form.Item>
			<Form.Item
				label="Team Member TPM Limit"
				name="team_member_tpm_limit"
				tooltip="Default tokens per minute limit for an individual team member. This limit applies to all requests the user makes within this team. Can be overridden per member."
			>
				<NumericalInput step={1} style={{ width: "100%" }} placeholder="e.g., 1000" />
			</Form.Item>
			<Form.Item
				label="Team Member RPM Limit"
				name="team_member_rpm_limit"
				tooltip="Default requests per minute limit for an individual team member. This limit applies to all requests the user makes within this team. Can be overridden per member."
			>
				<NumericalInput step={1} style={{ width: "100%" }} placeholder="e.g., 100" />
			</Form.Item>
			<Form.Item label="Reset Budget" name="budget_duration">
				<Select
					placeholder="n/a"
					options={[
						{ value: "24h", label: "daily" },
						{ value: "7d", label: "weekly" },
						{ value: "30d", label: "monthly" },
					]}
				/>
			</Form.Item>
			<Form.Item label="Tokens per minute Limit (TPM)" name="tpm_limit">
				<NumericalInput step={1} style={{ width: "100%" }} />
			</Form.Item>
			<Form.Item label="Requests per minute Limit (RPM)" name="rpm_limit">
				<NumericalInput step={1} style={{ width: "100%" }} />
			</Form.Item>
		</>
	);
}
