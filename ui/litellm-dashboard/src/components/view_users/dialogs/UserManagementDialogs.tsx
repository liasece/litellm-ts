import type { UserInfoV2Response } from "../../networking";
import type { Dispatch, SetStateAction } from "react";
import DeleteResourceModal from "../../common_components/DeleteResourceModal";
import OnboardingModal, { type InvitationLink } from "../../onboarding_link";
import type { TeamDisplayInfo, TeamOption } from "../types";
import AddUserToTeamModal from "./AddUserToTeamModal";

interface UserManagementDialogsProps {
	user: UserInfoV2Response;
	possibleUIRoles: Record<string, Record<string, string>> | null;
	baseUrl: string;
	invitationOpen: boolean;
	invitationLink: InvitationLink | null;
	deleteUserOpen: boolean;
	deletingUser: boolean;
	addTeamOpen: boolean;
	allTeams: TeamOption[];
	currentTeams: TeamDisplayInfo[];
	selectedTeamId: string;
	selectedRole: string;
	loadingTeams: boolean;
	addingTeam: boolean;
	removeTeamOpen: boolean;
	teamToRemove: TeamDisplayInfo | null;
	removingTeam: boolean;
	onInvitationOpenChange: Dispatch<SetStateAction<boolean>>;
	onDeleteUserCancel: () => void;
	onDeleteUserConfirm: () => void;
	onAddTeamCancel: () => void;
	onAddTeamSubmit: () => void;
	onSelectedTeamChange: (teamId: string) => void;
	onSelectedRoleChange: (role: string) => void;
	onRemoveTeamCancel: () => void;
	onRemoveTeamConfirm: () => void;
}

export default function UserManagementDialogs(props: UserManagementDialogsProps) {
	return (
		<>
			<OnboardingModal
				isInvitationLinkModalVisible={props.invitationOpen}
				setIsInvitationLinkModalVisible={props.onInvitationOpenChange}
				baseUrl={props.baseUrl}
				invitationLinkData={props.invitationLink}
				modalType="resetPassword"
			/>

			<DeleteResourceModal
				isOpen={props.deleteUserOpen}
				title="Delete User?"
				message="Are you sure you want to delete this user? This action cannot be undone."
				resourceInformationTitle="User Information"
				resourceInformation={[
					{ label: "Email", value: props.user.user_email },
					{ label: "User ID", value: props.user.user_id, code: true },
					{
						label: "Global Proxy Role",
						value:
							(props.user.user_role && props.possibleUIRoles?.[props.user.user_role]?.ui_label) ||
							props.user.user_role ||
							"-",
					},
					{
						label: "Total Spend (USD)",
						value:
							props.user.spend !== null && props.user.spend !== undefined ? props.user.spend.toFixed(2) : undefined,
					},
				]}
				onCancel={props.onDeleteUserCancel}
				onOk={props.onDeleteUserConfirm}
				confirmLoading={props.deletingUser}
			/>

			<DeleteResourceModal
				isOpen={props.removeTeamOpen}
				title="Remove from Team"
				alertMessage="Removing this user from the team will also delete any keys the user created for this team."
				message="Are you sure you want to remove this user from the team? This action cannot be undone."
				resourceInformationTitle="Team Membership"
				resourceInformation={[
					{ label: "Team", value: props.teamToRemove?.team_alias || props.teamToRemove?.team_id },
					{ label: "User ID", value: props.user.user_id, code: true },
					{ label: "Email", value: props.user.user_email },
				]}
				onCancel={props.onRemoveTeamCancel}
				onOk={props.onRemoveTeamConfirm}
				confirmLoading={props.removingTeam}
			/>

			<AddUserToTeamModal
				open={props.addTeamOpen}
				allTeams={props.allTeams}
				currentTeams={props.currentTeams}
				selectedTeamId={props.selectedTeamId}
				selectedRole={props.selectedRole}
				loadingTeams={props.loadingTeams}
				submitting={props.addingTeam}
				onSelectedTeamChange={props.onSelectedTeamChange}
				onSelectedRoleChange={props.onSelectedRoleChange}
				onCancel={props.onAddTeamCancel}
				onSubmit={props.onAddTeamSubmit}
			/>
		</>
	);
}
