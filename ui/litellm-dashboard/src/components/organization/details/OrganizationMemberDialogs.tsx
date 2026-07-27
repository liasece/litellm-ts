import UserSearchModal from "@/components/common_components/user_search_modal";
import type { Member } from "@/components/networking";
import MemberModal from "@/components/team/EditMembership";

export interface OrganizationMemberFormValues {
	user_email: string;
	user_id: string;
	role: string;
}

interface OrganizationMemberDialogsProps {
	accessToken: string | null;
	addOpen: boolean;
	editOpen: boolean;
	selectedMember: Member | null;
	onAddCancel: () => void;
	onEditCancel: () => void;
	onAdd: (values: OrganizationMemberFormValues) => void | Promise<void>;
	onEdit: (values: OrganizationMemberFormValues) => void;
}

export default function OrganizationMemberDialogs({
	accessToken,
	addOpen,
	editOpen,
	selectedMember,
	onAddCancel,
	onEditCancel,
	onAdd,
	onEdit,
}: OrganizationMemberDialogsProps) {
	return (
		<>
			<UserSearchModal
				isVisible={addOpen}
				onCancel={onAddCancel}
				onSubmit={onAdd}
				accessToken={accessToken}
				title="Add Organization Member"
				roles={[
					{
						label: "org_admin",
						value: "org_admin",
						description: "Can add and remove members, and change their roles.",
					},
					{
						label: "internal_user",
						value: "internal_user",
						description: "Can view/create keys for themselves within organization.",
					},
					{
						label: "internal_user_viewer",
						value: "internal_user_viewer",
						description: "Can only view their keys within organization.",
					},
				]}
				defaultRole="internal_user"
			/>
			<MemberModal
				visible={editOpen}
				onCancel={onEditCancel}
				onSubmit={onEdit}
				initialData={
					selectedMember
						? {
								user_email: selectedMember.user_email ?? "",
								user_id: selectedMember.user_id ?? "",
								role: selectedMember.role,
							}
						: null
				}
				mode="edit"
				config={{
					title: "Edit Member",
					showEmail: true,
					showUserId: true,
					roleOptions: [
						{ label: "Org Admin", value: "org_admin" },
						{ label: "Internal User", value: "internal_user" },
						{ label: "Internal User Viewer", value: "internal_user_viewer" },
					],
				}}
			/>
		</>
	);
}
