import { usePriceDisplay, Money } from "@/contexts/PriceDisplay";
import MemberTable from "@/components/common_components/MemberTable";
import type { Member, Organization } from "@/components/networking";
import type { ColumnsType } from "antd/es/table";
import { Typography } from "antd";
import { useMemo } from "react";

interface OrganizationMembersProps {
	organization: Organization;
	canEdit: boolean;
	onEdit: (member: Member) => void;
	onDelete: (member: Member) => void;
	onAdd: () => void;
}

export default function OrganizationMembers({
	organization,
	canEdit,
	onEdit,
	onDelete,
	onAdd,
}: OrganizationMembersProps) {
	usePriceDisplay();
	const extraColumns = useMemo<ColumnsType<Member>>(
		() => [
			{
				title: "Spend",
				key: "spend",
				render: (_value, record) => {
					const member = organization.members?.find((item) => item.user_id === record.user_id);
					return <Typography.Text>{<Money value={member?.spend ?? 0} decimals={4} />}</Typography.Text>;
				},
			},
			{
				title: "Created At",
				key: "created_at",
				render: (_value, record) => {
					const member = organization.members?.find((item) => item.user_id === record.user_id);
					return (
						<Typography.Text>{member?.created_at ? new Date(member.created_at).toLocaleString() : "-"}</Typography.Text>
					);
				},
			},
		],
		[organization.members],
	);

	return (
		<MemberTable
			members={(organization.members || []).map((member) => ({
				role: member.user_role || "",
				user_id: member.user_id,
				user_email: member.user_email,
			}))}
			canEdit={canEdit}
			onEdit={onEdit}
			onDelete={onDelete}
			onAddMember={onAdd}
			roleColumnTitle="Organization Role"
			extraColumns={extraColumns}
			emptyText="No members found"
		/>
	);
}
