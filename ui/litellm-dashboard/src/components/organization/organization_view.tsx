import { useTeams } from "@/app/(dashboard)/hooks/teams/useTeams";
import { createTeamAliasMap } from "@/utils/teamUtils";
import { Form, Tabs } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import NotificationsManager from "../molecules/notifications_manager";
import {
	type Member,
	type Organization,
	organizationInfoCall,
	organizationMemberAddCall,
	organizationMemberDeleteCall,
	organizationMemberUpdateCall,
	organizationUpdateCall,
} from "../networking";
import OrganizationHeader from "./details/OrganizationHeader";
import OrganizationMemberDialogs, { type OrganizationMemberFormValues } from "./details/OrganizationMemberDialogs";
import OrganizationMembers from "./details/OrganizationMembers";
import OrganizationOverview from "./details/OrganizationOverview";
import OrganizationSettings, { type OrganizationFormValues } from "./details/OrganizationSettings";

interface OrganizationInfoProps {
	organizationId: string;
	onClose: () => void;
	accessToken: string | null;
	is_org_admin: boolean;
	is_proxy_admin: boolean;
	userModels: string[];
	editOrg: boolean;
}

export default function OrganizationInfoView({
	organizationId,
	onClose,
	accessToken,
	is_org_admin,
	is_proxy_admin,
	editOrg,
}: OrganizationInfoProps) {
	const [organization, setOrganization] = useState<Organization | null>(null);
	const [loading, setLoading] = useState(true);
	const [form] = Form.useForm<OrganizationFormValues>();
	const [editing, setEditing] = useState(false);
	const [addMemberOpen, setAddMemberOpen] = useState(false);
	const [editMemberOpen, setEditMemberOpen] = useState(false);
	const [selectedMember, setSelectedMember] = useState<Member | null>(null);
	const [saving, setSaving] = useState(false);
	const canEdit = is_org_admin || is_proxy_admin;
	const { data: teams } = useTeams();
	const teamAliasMap = useMemo(() => createTeamAliasMap(teams), [teams]);

	const fetchOrganization = useCallback(async () => {
		setLoading(true);
		if (!accessToken) {
			setOrganization(null);
			setLoading(false);
			return;
		}

		try {
			setOrganization(await organizationInfoCall(accessToken, organizationId));
		} catch {
			setOrganization(null);
			NotificationsManager.fromBackend("Failed to load organization information");
		} finally {
			setLoading(false);
		}
	}, [accessToken, organizationId]);

	useEffect(() => {
		// Organization identity is an external input; refetching intentionally transitions the local request state.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void fetchOrganization();
	}, [fetchOrganization]);

	const handleMemberAdd = async (values: OrganizationMemberFormValues) => {
		if (!accessToken) return;
		try {
			await organizationMemberAddCall(accessToken, organizationId, values);
			NotificationsManager.success("Organization member added successfully");
			setAddMemberOpen(false);
			form.resetFields();
			await fetchOrganization();
		} catch {
			NotificationsManager.fromBackend("Failed to add organization member");
		}
	};

	const handleMemberUpdate = async (values: OrganizationMemberFormValues) => {
		if (!accessToken) return;
		try {
			await organizationMemberUpdateCall(accessToken, organizationId, values);
			NotificationsManager.success("Organization member updated successfully");
			setEditMemberOpen(false);
			form.resetFields();
			await fetchOrganization();
		} catch {
			NotificationsManager.fromBackend("Failed to update organization member");
		}
	};

	const handleMemberDelete = async (member: Member) => {
		if (!accessToken || !member.user_id) return;
		try {
			await organizationMemberDeleteCall(accessToken, organizationId, member.user_id);
			NotificationsManager.success("Organization member deleted successfully");
			setEditMemberOpen(false);
			await fetchOrganization();
		} catch {
			NotificationsManager.fromBackend("Failed to delete organization member");
		}
	};

	const handleOrganizationUpdate = async (values: OrganizationFormValues) => {
		if (!accessToken) return;
		setSaving(true);
		try {
			const mcpSelection = values.mcp_servers_and_groups ?? {};
			await organizationUpdateCall(accessToken, {
				organization_id: organizationId,
				organization_alias: values.organization_alias,
				models: values.models,
				litellm_budget_table: {
					tpm_limit: values.tpm_limit,
					rpm_limit: values.rpm_limit,
					max_budget: values.max_budget,
					budget_duration: values.budget_duration,
				},
				metadata: values.metadata ? JSON.parse(values.metadata) : null,
				object_permission: {
					...organization?.object_permission,
					vector_stores: values.vector_stores ?? [],
					mcp_servers: mcpSelection.servers ?? [],
					mcp_access_groups: mcpSelection.accessGroups ?? [],
				},
			});
			NotificationsManager.success("Organization settings updated successfully");
			setEditing(false);
			await fetchOrganization();
		} catch {
			NotificationsManager.fromBackend("Failed to update organization settings");
		} finally {
			setSaving(false);
		}
	};

	if (loading) return <div className="p-4">Loading...</div>;
	if (!organization) return <div className="p-4">Organization not found</div>;

	return (
		<div className="h-screen w-full bg-white p-4">
			<OrganizationHeader
				name={organization.organization_alias}
				organizationId={organization.organization_id}
				onBack={onClose}
			/>
			<Tabs
				defaultActiveKey={editOrg ? "settings" : "overview"}
				className="mb-4"
				items={[
					{
						key: "overview",
						label: "Overview",
						children: (
							<OrganizationOverview organization={organization} teamAliasMap={teamAliasMap} accessToken={accessToken} />
						),
					},
					{
						key: "members",
						label: "Members",
						children: (
							<OrganizationMembers
								organization={organization}
								canEdit={canEdit}
								onEdit={(member) => {
									setSelectedMember(member);
									setEditMemberOpen(true);
								}}
								onDelete={(member) => void handleMemberDelete(member)}
								onAdd={() => setAddMemberOpen(true)}
							/>
						),
					},
					{
						key: "settings",
						label: "Settings",
						children: (
							<OrganizationSettings
								organization={organization}
								form={form}
								accessToken={accessToken}
								canEdit={canEdit}
								editing={editing}
								saving={saving}
								onEdit={() => setEditing(true)}
								onCancel={() => setEditing(false)}
								onSave={(values) => void handleOrganizationUpdate(values)}
							/>
						),
					},
				]}
			/>
			<OrganizationMemberDialogs
				accessToken={accessToken}
				addOpen={addMemberOpen}
				editOpen={editMemberOpen}
				selectedMember={selectedMember}
				onAddCancel={() => setAddMemberOpen(false)}
				onEditCancel={() => setEditMemberOpen(false)}
				onAdd={handleMemberAdd}
				onEdit={(values) => void handleMemberUpdate(values)}
			/>
		</div>
	);
}
