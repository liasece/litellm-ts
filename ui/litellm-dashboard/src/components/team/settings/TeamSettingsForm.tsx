import { SaveOutlined } from "@ant-design/icons";
import { Button, Form, type FormInstance } from "antd";
import { useEffect } from "react";
import type { TeamData } from "../types";
import TeamAdvancedSettingsFields from "./TeamAdvancedSettingsFields";
import TeamGeneralSettingsFields from "./TeamGeneralSettingsFields";
import TeamPolicySettingsFields from "./TeamPolicySettingsFields";
import TeamResourcePermissionFields from "./TeamResourcePermissionFields";

interface TeamSettingsFormProps {
	form: FormInstance;
	info: TeamData["team_info"];
	teamId: string;
	userRole: string | null;
	accessToken: string | null;
	guardrails: string[];
	policies: string[];
	premiumUser: boolean;
	saving: boolean;
	onSave: (values: any) => void;
	onCancel: () => void;
}

const emptyWhenNull = <T,>(value: T | null | undefined) => value ?? undefined;

export function getTeamSettingsInitialValues(info: TeamData["team_info"]) {
	const { logging, secret_manager_settings, soft_budget_alerting_emails, ...metadata } = info.metadata ?? {};
	return {
		...info,
		tpm_limit: emptyWhenNull(info.tpm_limit),
		rpm_limit: emptyWhenNull(info.rpm_limit),
		max_budget: emptyWhenNull(info.max_budget),
		soft_budget: emptyWhenNull(info.soft_budget),
		team_member_tpm_limit: emptyWhenNull(info.team_member_budget_table?.tpm_limit),
		team_member_rpm_limit: emptyWhenNull(info.team_member_budget_table?.rpm_limit),
		team_member_budget: emptyWhenNull(info.team_member_budget_table?.max_budget),
		team_member_budget_duration: info.team_member_budget_table?.budget_duration,
		team_member_key_duration: info.metadata?.team_member_key_duration,
		guardrails: info.metadata?.guardrails || [],
		policies: info.policies || [],
		disable_global_guardrails: info.metadata?.disable_global_guardrails || false,
		soft_budget_alerting_emails: Array.isArray(soft_budget_alerting_emails)
			? soft_budget_alerting_emails.join(", ")
			: "",
		metadata: info.metadata ? JSON.stringify(metadata, null, 2) : "",
		logging_settings: logging || [],
		secret_manager_settings: secret_manager_settings ? JSON.stringify(secret_manager_settings, null, 2) : "",
		vector_stores: info.object_permission?.vector_stores || [],
		mcp_servers_and_groups: {
			servers: info.object_permission?.mcp_servers || [],
			accessGroups: info.object_permission?.mcp_access_groups || [],
		},
		mcp_tool_permissions: info.object_permission?.mcp_tool_permissions || {},
		agents_and_groups: {
			agents: info.object_permission?.agents || [],
			accessGroups: info.object_permission?.agent_access_groups || [],
		},
		access_group_ids: info.access_group_ids || [],
	};
}

export default function TeamSettingsForm({
	form,
	info,
	teamId,
	userRole,
	accessToken,
	guardrails,
	policies,
	premiumUser,
	saving,
	onSave,
	onCancel,
}: TeamSettingsFormProps) {
	useEffect(() => {
		form.setFieldsValue(getTeamSettingsInitialValues(info));
	}, [form, info]);

	const handleCancel = () => {
		form.resetFields();
		onCancel();
	};

	return (
		<Form form={form} onFinish={onSave} initialValues={getTeamSettingsInitialValues(info)} layout="vertical">
			<TeamGeneralSettingsFields form={form} teamId={teamId} info={info} userRole={userRole} />
			<TeamPolicySettingsFields guardrails={guardrails} policies={policies} />
			<TeamResourcePermissionFields form={form} accessToken={accessToken} />
			<TeamAdvancedSettingsFields form={form} premiumUser={premiumUser} />
			<div className="sticky bottom-[-1.5rem] inset-x-[-1.5rem] z-10 border-t border-gray-200 bg-white p-4 pr-0">
				<div className="flex items-center justify-end gap-2">
					<Button onClick={handleCancel} disabled={saving}>
						Cancel
					</Button>
					<Button icon={<SaveOutlined className="h-4 w-4" />} type="primary" htmlType="submit" loading={saving}>
						Save Changes
					</Button>
				</div>
			</div>
		</Form>
	);
}
