import UserSearchModal from "@/components/common_components/user_search_modal";
import type { Member } from "@/components/networking";
import { InfoCircleOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import DeleteResourceModal from "../../common_components/DeleteResourceModal";
import MemberModal from "../EditMembership";

interface TeamMemberDialogsProps {
	accessToken: string | null;
	teamId: string;
	editMemberOpen: boolean;
	selectedMember: Member | null;
	addMemberOpen: boolean;
	deleteMemberOpen: boolean;
	memberToDelete: Member | null;
	deleting: boolean;
	onEditMemberClose: () => void;
	onEditMemberSubmit: (values: any) => void;
	onAddMemberClose: () => void;
	onAddMemberSubmit: (values: any) => void;
	onDeleteMemberClose: () => void;
	onDeleteMemberConfirm: () => void;
}

function MemberLimitLabel({ children, tooltip }: { children: string; tooltip: string }) {
	return (
		<span>
			{children}{" "}
			<Tooltip title={tooltip}>
				<InfoCircleOutlined style={{ marginLeft: 4 }} />
			</Tooltip>
		</span>
	);
}

export default function TeamMemberDialogs({
	accessToken,
	teamId,
	editMemberOpen,
	selectedMember,
	addMemberOpen,
	deleteMemberOpen,
	memberToDelete,
	deleting,
	onEditMemberClose,
	onEditMemberSubmit,
	onAddMemberClose,
	onAddMemberSubmit,
	onDeleteMemberClose,
	onDeleteMemberConfirm,
}: TeamMemberDialogsProps) {
	return (
		<>
			<MemberModal
				visible={editMemberOpen}
				onCancel={onEditMemberClose}
				onSubmit={onEditMemberSubmit}
				initialData={selectedMember}
				mode="edit"
				config={{
					title: "Edit Member",
					showEmail: true,
					showUserId: true,
					roleOptions: [
						{ label: "Admin", value: "admin" },
						{ label: "User", value: "user" },
					],
					additionalFields: [
						{
							name: "max_budget_in_team",
							label: (
								<MemberLimitLabel tooltip="Maximum amount in USD this member can spend within this team. This is separate from any global user budget limits">
									Team Member Budget (USD)
								</MemberLimitLabel>
							),
							type: "numerical" as const,
							step: 0.01,
							min: 0,
							placeholder: "Budget limit for this member within this team",
						},
						{
							name: "tpm_limit",
							label: (
								<MemberLimitLabel tooltip="Maximum tokens per minute this member can use within this team. This is separate from any global user TPM limit">
									Team Member TPM Limit
								</MemberLimitLabel>
							),
							type: "numerical" as const,
							step: 1,
							min: 0,
							placeholder: "Tokens per minute limit for this member in this team",
						},
						{
							name: "rpm_limit",
							label: (
								<MemberLimitLabel tooltip="Maximum requests per minute this member can make within this team. This is separate from any global user RPM limit">
									Team Member RPM Limit
								</MemberLimitLabel>
							),
							type: "numerical" as const,
							step: 1,
							min: 0,
							placeholder: "Requests per minute limit for this member in this team",
						},
					],
				}}
			/>

			<UserSearchModal
				isVisible={addMemberOpen}
				onCancel={onAddMemberClose}
				onSubmit={onAddMemberSubmit}
				accessToken={accessToken}
				teamId={teamId}
			/>

			<DeleteResourceModal
				isOpen={deleteMemberOpen}
				title="Delete Team Member"
				alertMessage="Removing team members will also delete any keys created by or created for this member."
				message="Are you sure you want to remove this member from the team? This action cannot be undone."
				resourceInformationTitle="Team Member Information"
				resourceInformation={[
					{ label: "User ID", value: memberToDelete?.user_id, code: true },
					{ label: "Email", value: memberToDelete?.user_email },
					{ label: "Role", value: memberToDelete?.role },
				]}
				onCancel={onDeleteMemberClose}
				onOk={onDeleteMemberConfirm}
				confirmLoading={deleting}
			/>
		</>
	);
}
