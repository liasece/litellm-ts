import BulkEditUserModal from "../../BulkEditUsers";
import DeleteResourceModal from "../../common_components/DeleteResourceModal";
import EditUserModal from "../../edit_user";
import OnboardingModal, { type InvitationLink } from "../../onboarding_link";
import type { UserInfo } from "../types";
import type { Dispatch, SetStateAction } from "react";

interface UserListDialogsProps {
	editOpen: boolean;
	selectedUser: UserInfo | null;
	deleteOpen: boolean;
	deleting: boolean;
	userToDelete: UserInfo | null;
	invitationOpen: boolean;
	invitationLink: InvitationLink | null;
	baseUrl: string;
	bulkEditOpen: boolean;
	selectedUsers: UserInfo[];
	possibleUIRoles: Record<string, Record<string, string>>;
	accessToken: string | null;
	teams: any[] | null;
	userRole: string | null;
	userModels: string[];
	allowAllUsers: boolean;
	onEditCancel: () => void;
	onEditSubmit: (user: any) => void | Promise<void>;
	onDeleteCancel: () => void;
	onDeleteConfirm: () => void | Promise<void>;
	onInvitationOpenChange: Dispatch<SetStateAction<boolean>>;
	onBulkEditCancel: () => void;
	onBulkEditSuccess: () => void;
}

export default function UserListDialogs(props: UserListDialogsProps) {
	return (
		<>
			<EditUserModal
				visible={props.editOpen}
				possibleUIRoles={props.possibleUIRoles}
				onCancel={props.onEditCancel}
				user={props.selectedUser}
				onSubmit={props.onEditSubmit}
			/>
			<DeleteResourceModal
				isOpen={props.deleteOpen}
				title="Delete User?"
				message="Are you sure you want to delete this user? This action cannot be undone."
				resourceInformationTitle="User Information"
				resourceInformation={[
					{ label: "Email", value: props.userToDelete?.user_email },
					{ label: "User ID", value: props.userToDelete?.user_id, code: true },
					{
						label: "Global Proxy Role",
						value:
							(props.userToDelete && props.possibleUIRoles?.[props.userToDelete.user_role]?.ui_label) ||
							props.userToDelete?.user_role ||
							"-",
					},
					{ label: "Total Spend (USD)", value: props.userToDelete?.spend?.toFixed(2) },
				]}
				onCancel={props.onDeleteCancel}
				onOk={props.onDeleteConfirm}
				confirmLoading={props.deleting}
			/>
			<OnboardingModal
				isInvitationLinkModalVisible={props.invitationOpen}
				setIsInvitationLinkModalVisible={props.onInvitationOpenChange}
				baseUrl={props.baseUrl}
				invitationLinkData={props.invitationLink}
				modalType="resetPassword"
			/>
			<BulkEditUserModal
				open={props.bulkEditOpen}
				onCancel={props.onBulkEditCancel}
				selectedUsers={props.selectedUsers}
				possibleUIRoles={props.possibleUIRoles}
				accessToken={props.accessToken}
				onSuccess={props.onBulkEditSuccess}
				teams={props.teams}
				userRole={props.userRole}
				userModels={props.userModels}
				allowAllUsers={props.allowAllUsers}
			/>
		</>
	);
}
