import { EditOutlined } from "@ant-design/icons";
import { Card, Title } from "@tremor/react";
import { Button, type FormInstance } from "antd";
import type { TeamData } from "../types";
import TeamSettingsForm from "./TeamSettingsForm";
import TeamSettingsSummary from "./TeamSettingsSummary";

interface TeamSettingsPanelProps {
	form: FormInstance;
	info: TeamData["team_info"];
	teamId: string;
	userRole: string | null;
	accessToken: string | null;
	guardrails: string[];
	policies: string[];
	premiumUser: boolean;
	canEdit: boolean;
	editing: boolean;
	saving: boolean;
	onEdit: () => void;
	onCancel: () => void;
	onSave: (values: any) => void;
}

export default function TeamSettingsPanel(props: TeamSettingsPanelProps) {
	return (
		<Card className="max-h-[65vh] overflow-y-auto">
			<div className="mb-4 flex items-center justify-between">
				<Title>Team Settings</Title>
				{props.canEdit && !props.editing && (
					<Button icon={<EditOutlined className="h-4 w-4" />} onClick={props.onEdit}>
						Edit Settings
					</Button>
				)}
			</div>
			{props.editing ? (
				<TeamSettingsForm
					form={props.form}
					info={props.info}
					teamId={props.teamId}
					userRole={props.userRole}
					accessToken={props.accessToken}
					guardrails={props.guardrails}
					policies={props.policies}
					premiumUser={props.premiumUser}
					saving={props.saving}
					onSave={props.onSave}
					onCancel={props.onCancel}
				/>
			) : (
				<TeamSettingsSummary info={props.info} accessToken={props.accessToken} />
			)}
		</Card>
	);
}
