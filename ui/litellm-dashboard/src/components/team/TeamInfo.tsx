import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { useOrganizations } from "@/app/(dashboard)/hooks/organizations/useOrganizations";
import {
	getGuardrailsList,
	getPoliciesList,
	getPolicyInfoWithGuardrails,
	Member,
	Organization,
	organizationInfoCall,
	teamInfoCall,
	teamMemberAddCall,
	teamMemberDeleteCall,
	teamMemberUpdateCall,
	teamUpdateCall,
} from "@/components/networking";
import { mapEmptyStringToNull } from "@/utils/keyUpdateUtils";
import { Button, Form, Tabs } from "antd";
import MessageManager from "@/components/molecules/message_manager";
import React, { useEffect, useMemo, useState } from "react";
import { copyToClipboard as utilCopyToClipboard } from "../../utils/dataUtils";
import ResourceDetailsDrawer from "../common_components/ResourceDetailsDrawer";
import NotificationsManager from "../molecules/notifications_manager";
import TeamDetailsHeader from "./details/TeamDetailsHeader";
import TeamOverview from "./details/TeamOverview";
import TeamSettingsPanel from "./settings/TeamSettingsPanel";
import MemberPermissions from "./member_permissions";
import TeamMemberDialogs from "./members/TeamMemberDialogs";
import {
	getTeamInfoDefaultTab,
	getTeamInfoVisibleTabs,
	TEAM_INFO_TAB_KEYS,
	TEAM_INFO_TAB_LABELS,
} from "./tabVisibilityUtils";
import TeamMembersComponent from "./TeamMemberTab";
import { TeamVirtualKeysTable } from "./TeamVirtualKeysTable";
import type { TeamData } from "./types";

export type { TeamData, TeamMembership } from "./types";

export interface TeamInfoProps {
	teamId: string;
	onUpdate: (data: any) => void;
	onClose: () => void;
	accessToken: string | null;
	is_team_admin: boolean;
	is_proxy_admin: boolean;
	is_org_admin?: boolean;
	userModels: string[];
	editTeam: boolean;
	premiumUser?: boolean;
}

const TeamInfoView: React.FC<TeamInfoProps> = ({
	teamId,
	onClose,
	accessToken,
	is_team_admin,
	is_proxy_admin,
	is_org_admin = false,
	editTeam,
	premiumUser = false,
	onUpdate,
}) => {
	const [teamData, setTeamData] = useState<TeamData | null>(null);
	const [loading, setLoading] = useState(true);
	const [isAddMemberModalVisible, setIsAddMemberModalVisible] = useState(false);
	const [form] = Form.useForm();
	const [isEditMemberModalVisible, setIsEditMemberModalVisible] = useState(false);
	const [selectedEditMember, setSelectedEditMember] = useState<Member | null>(null);
	const [isEditing, setIsEditing] = useState(false);
	const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
	const [guardrailsList, setGuardrailsList] = useState<string[]>([]);
	const [policiesList, setPoliciesList] = useState<string[]>([]);
	const [policyGuardrails, setPolicyGuardrails] = useState<Record<string, string[]>>({});
	const [loadingPolicies, setLoadingPolicies] = useState(false);
	const [memberToDelete, setMemberToDelete] = useState<Member | null>(null);
	const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [isTeamSaving, setIsTeamSaving] = useState(false);
	const [organization, setOrganization] = useState<Organization | null>(null);
	const { userRole, userId } = useAuthorized();
	const { data: userOrganizations = [] } = useOrganizations();

	// Check if user is org admin for this team's organization
	const isOrgAdminForTeam = useMemo(() => {
		const teamOrgId = teamData?.team_info?.organization_id;
		if (!teamOrgId || !userId) return false;
		const org = userOrganizations.find((o) => o.organization_id === teamOrgId);
		return org?.members?.some((m: any) => m.user_id === userId && m.user_role === "org_admin") ?? false;
	}, [teamData, userOrganizations, userId]);

	const canEditTeam = is_team_admin || is_proxy_admin || is_org_admin || isOrgAdminForTeam;
	const visibleTabs = useMemo(() => getTeamInfoVisibleTabs(canEditTeam), [canEditTeam]);
	const defaultTabKey = useMemo(() => getTeamInfoDefaultTab(editTeam, canEditTeam), [editTeam, canEditTeam]);

	const fetchTeamInfo = async () => {
		try {
			setLoading(true);
			if (!accessToken) return;
			const response = await teamInfoCall(accessToken, teamId);
			setTeamData(response);
		} catch (error) {
			NotificationsManager.fromBackend("Failed to load team information");
			console.error("Error fetching team info:", error);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchTeamInfo();
	}, [teamId, accessToken]);

	// Fetch organization data when team has organization_id
	useEffect(() => {
		const fetchOrganization = async () => {
			if (!accessToken || !teamData?.team_info?.organization_id) {
				setOrganization(null);
				return;
			}

			try {
				const orgData = await organizationInfoCall(accessToken, teamData.team_info.organization_id);
				setOrganization(orgData);
			} catch (error) {
				console.error("Error fetching organization info:", error);
				setOrganization(null);
			}
		};

		fetchOrganization();
	}, [accessToken, teamData?.team_info?.organization_id]);

	useEffect(() => {
		const fetchGuardrails = async () => {
			try {
				if (!accessToken) return;
				const response = await getGuardrailsList(accessToken);
				const guardrailNames = response.guardrails.map((g: { guardrail_name: string }) => g.guardrail_name);
				setGuardrailsList(guardrailNames);
			} catch (error) {
				console.error("Failed to fetch guardrails:", error);
			}
		};

		const fetchPolicies = async () => {
			try {
				if (!accessToken) return;
				const response = await getPoliciesList(accessToken);
				const policyNames = response.policies.map((p: { policy_name: string }) => p.policy_name);
				setPoliciesList(policyNames);
			} catch (error) {
				console.error("Failed to fetch policies:", error);
			}
		};

		fetchGuardrails();
		fetchPolicies();
	}, [accessToken]);

	// Fetch resolved guardrails for all policies
	useEffect(() => {
		const fetchPolicyGuardrails = async () => {
			if (!accessToken || !teamData?.team_info?.policies || teamData.team_info.policies.length === 0) {
				return;
			}

			setLoadingPolicies(true);
			const guardrailsMap: Record<string, string[]> = {};

			try {
				await Promise.all(
					teamData.team_info.policies.map(async (policyName: string) => {
						try {
							const policyInfo = await getPolicyInfoWithGuardrails(accessToken, policyName);
							guardrailsMap[policyName] = policyInfo.resolved_guardrails || [];
						} catch (error) {
							console.error(`Failed to fetch guardrails for policy ${policyName}:`, error);
							guardrailsMap[policyName] = [];
						}
					}),
				);
				setPolicyGuardrails(guardrailsMap);
			} catch (error) {
				console.error("Failed to fetch policy guardrails:", error);
			} finally {
				setLoadingPolicies(false);
			}
		};

		fetchPolicyGuardrails();
	}, [accessToken, teamData?.team_info?.policies]);

	const handleMemberCreate = async (values: any) => {
		try {
			if (accessToken == null) return;

			const member: Member = {
				user_email: values.user_email,
				user_id: values.user_id,
				role: values.role,
			};

			await teamMemberAddCall(accessToken, teamId, member);

			NotificationsManager.success("Team member added successfully");
			setIsAddMemberModalVisible(false);
			form.resetFields();

			// Fetch updated team info
			const updatedTeamData = await teamInfoCall(accessToken, teamId);
			setTeamData(updatedTeamData);

			// Notify parent component of the update
			onUpdate(updatedTeamData);
		} catch (error: any) {
			let errMsg = "Failed to add team member";

			if (error?.raw?.detail?.error?.includes("Assigning team admins is a premium feature")) {
				errMsg = "Assigning admins is an enterprise-only feature. Please upgrade your LiteLLM plan to enable this.";
			} else if (error?.message) {
				errMsg = error.message;
			}

			NotificationsManager.fromBackend(errMsg);
			console.error("Error adding team member:", error);
		}
	};

	const handleMemberUpdate = async (values: any) => {
		try {
			if (accessToken == null) {
				return;
			}

			const member: Member = {
				user_email: values.user_email,
				user_id: values.user_id,
				role: values.role,
				max_budget_in_team: values.max_budget_in_team,
				tpm_limit: values.tpm_limit,
				rpm_limit: values.rpm_limit,
			};
			MessageManager.destroy(); // Remove all existing toasts

			await teamMemberUpdateCall(accessToken, teamId, member);

			NotificationsManager.success("Team member updated successfully");
			setIsEditMemberModalVisible(false);

			// Fetch updated team info
			const updatedTeamData = await teamInfoCall(accessToken, teamId);
			setTeamData(updatedTeamData);

			// Notify parent component of the update
			onUpdate(updatedTeamData);
		} catch (error: any) {
			let errMsg = "Failed to update team member";
			if (error?.raw?.detail?.includes("Assigning team admins is a premium feature")) {
				errMsg = "Assigning admins is an enterprise-only feature. Please upgrade your LiteLLM plan to enable this.";
			} else if (error?.message) {
				errMsg = error.message;
			}
			setIsEditMemberModalVisible(false);

			MessageManager.destroy(); // Remove all existing toasts

			NotificationsManager.fromBackend(errMsg);
			console.error("Error updating team member:", error);
		}
	};

	const handleMemberDelete = (member: Member) => {
		setMemberToDelete(member);
		setIsDeleteModalOpen(true);
	};

	const handleDeleteConfirm = async () => {
		if (!memberToDelete || !accessToken) return;

		setIsDeleting(true);
		try {
			await teamMemberDeleteCall(accessToken, teamId, memberToDelete);

			NotificationsManager.success("Team member removed successfully");

			// Fetch updated team info
			const updatedTeamData = await teamInfoCall(accessToken, teamId);
			setTeamData(updatedTeamData);

			// Notify parent component of the update
			onUpdate(updatedTeamData);
		} catch (error) {
			NotificationsManager.fromBackend("Failed to remove team member");
			console.error("Error removing team member:", error);
		} finally {
			setIsDeleting(false);
			setIsDeleteModalOpen(false);
			setMemberToDelete(null);
		}
	};

	const handleDeleteCancel = () => {
		setIsDeleteModalOpen(false);
		setMemberToDelete(null);
	};

	const handleTeamUpdate = async (values: any) => {
		try {
			if (!accessToken) return;
			setIsTeamSaving(true);

			let parsedMetadata = {};
			try {
				const rawMetadata = values.metadata ? JSON.parse(values.metadata) : {};
				// Exclude soft_budget_alerting_emails from parsed metadata since it's handled separately
				const { soft_budget_alerting_emails, ...rest } = rawMetadata;
				parsedMetadata = rest;
			} catch (e) {
				NotificationsManager.fromBackend("Invalid JSON in metadata field");
				return;
			}

			let secretManagerSettings: Record<string, any> | undefined;
			if (typeof values.secret_manager_settings === "string") {
				const trimmedSecretConfig = values.secret_manager_settings.trim();
				if (trimmedSecretConfig.length > 0) {
					try {
						secretManagerSettings = JSON.parse(values.secret_manager_settings);
					} catch (e) {
						NotificationsManager.fromBackend("Invalid JSON in secret manager settings");
						return;
					}
				}
			}

			const sanitizeNumeric = (v: any) => {
				if (v === null || v === undefined) return null;
				if (typeof v === "string" && v.trim() === "") return null;
				if (typeof v === "number" && Number.isNaN(v)) return null;
				return v;
			};

			const updateData: any = {
				team_id: teamId,
				team_alias: values.team_alias,
				models: values.models,
				tpm_limit: sanitizeNumeric(values.tpm_limit),
				rpm_limit: sanitizeNumeric(values.rpm_limit),
				max_budget: values.max_budget,
				soft_budget: sanitizeNumeric(values.soft_budget),
				budget_duration: values.budget_duration,
				metadata: {
					...parsedMetadata,
					...(values.guardrails?.length > 0 ? { guardrails: values.guardrails } : {}),
					...(values.logging_settings?.length > 0 ? { logging: values.logging_settings } : {}),
					disable_global_guardrails: values.disable_global_guardrails || false,
					soft_budget_alerting_emails:
						typeof values.soft_budget_alerting_emails === "string"
							? values.soft_budget_alerting_emails
									.split(",")
									.map((email: string) => email.trim())
									.filter((email: string) => email.length > 0)
							: values.soft_budget_alerting_emails || [],
					...(secretManagerSettings !== undefined ? { secret_manager_settings: secretManagerSettings } : {}),
				},
				...(values.policies?.length > 0 ? { policies: values.policies } : {}),
				organization_id: values.organization_id,
			};

			updateData.max_budget = mapEmptyStringToNull(updateData.max_budget);
			updateData.team_member_budget_duration = values.team_member_budget_duration;

			if (values.team_member_budget !== undefined) {
				updateData.team_member_budget = Number(values.team_member_budget);
			}

			if (values.team_member_key_duration !== undefined) {
				updateData.team_member_key_duration = values.team_member_key_duration;
			}

			if (values.team_member_tpm_limit !== undefined || values.team_member_rpm_limit !== undefined) {
				updateData.team_member_tpm_limit = sanitizeNumeric(values.team_member_tpm_limit);
				updateData.team_member_rpm_limit = sanitizeNumeric(values.team_member_rpm_limit);
			}

			// Handle object_permission updates
			const { servers, accessGroups } = values.mcp_servers_and_groups || {
				servers: [],
				accessGroups: [],
			};
			const serverIds = new Set(servers || []);
			const mcpToolPermissions = Object.fromEntries(
				Object.entries(values.mcp_tool_permissions || {}).filter(([serverId]) => serverIds.has(serverId)),
			);

			updateData.object_permission = {};
			if (servers) {
				updateData.object_permission.mcp_servers = servers;
			}
			if (accessGroups) {
				updateData.object_permission.mcp_access_groups = accessGroups;
			}
			if (mcpToolPermissions) {
				updateData.object_permission.mcp_tool_permissions = mcpToolPermissions;
			}
			delete values.mcp_servers_and_groups;
			delete values.mcp_tool_permissions;

			// Handle agent permissions
			const { agents, accessGroups: agentAccessGroups } = values.agents_and_groups || {
				agents: [],
				accessGroups: [],
			};
			if (agents && agents.length > 0) {
				updateData.object_permission.agents = agents;
			}
			if (agentAccessGroups && agentAccessGroups.length > 0) {
				updateData.object_permission.agent_access_groups = agentAccessGroups;
			}
			delete values.agents_and_groups;

			// Handle vector stores permissions
			if (values.vector_stores && values.vector_stores.length > 0) {
				updateData.object_permission.vector_stores = values.vector_stores;
			}

			// Pass access_group_ids to the update request
			if (values.access_group_ids !== undefined) {
				updateData.access_group_ids = values.access_group_ids;
			}

			await teamUpdateCall(accessToken, updateData);
			const updatedTeamData = await teamInfoCall(accessToken, teamId);

			NotificationsManager.success("Team settings updated successfully");
			setTeamData(updatedTeamData);
			onUpdate(updatedTeamData);
			setIsEditing(false);
		} catch (error) {
			console.error("Error updating team:", error);
		} finally {
			setIsTeamSaving(false);
		}
	};

	if (loading) {
		return <div className="p-4">Loading...</div>;
	}

	if (!teamData?.team_info) {
		return <div className="p-4">Team not found</div>;
	}

	const { team_info: info } = teamData;

	const copyToClipboard = async (text: string, key: string) => {
		const success = await utilCopyToClipboard(text);
		if (success) {
			setCopiedStates((prev) => ({ ...prev, [key]: true }));
			setTimeout(() => {
				setCopiedStates((prev) => ({ ...prev, [key]: false }));
			}, 2000);
		}
	};

	return (
		<ResourceDetailsDrawer
			open
			onClose={() => {
				setIsEditing(false);
				onClose();
			}}
			title={info.team_alias || "Team"}
			subtitle={info.team_id}
			actions={
				canEditTeam ? (
					<Button type="primary" onClick={() => setIsEditing(true)}>
						Edit
					</Button>
				) : undefined
			}
		>
			<div className="p-4">
				<TeamDetailsHeader
					teamAlias={info.team_alias}
					teamId={info.team_id}
					teamIdCopied={Boolean(copiedStates["team-id"])}
					onBack={onClose}
					onCopyTeamId={() => copyToClipboard(info.team_id, "team-id")}
				/>

				<Tabs
					defaultActiveKey={defaultTabKey}
					className="mb-4"
					items={[
						{
							key: TEAM_INFO_TAB_KEYS.OVERVIEW,
							label: TEAM_INFO_TAB_LABELS[TEAM_INFO_TAB_KEYS.OVERVIEW],
							children: (
								<TeamOverview
									teamData={teamData}
									accessToken={accessToken}
									policyGuardrails={policyGuardrails}
									loadingPolicies={loadingPolicies}
								/>
							),
						},
						{
							key: TEAM_INFO_TAB_KEYS.VIRTUAL_KEYS,
							label: TEAM_INFO_TAB_LABELS[TEAM_INFO_TAB_KEYS.VIRTUAL_KEYS],
							children: (
								<TeamVirtualKeysTable teamId={teamId} teamAlias={info.team_alias} organization={organization} />
							),
						},
						{
							key: TEAM_INFO_TAB_KEYS.MEMBERS,
							label: TEAM_INFO_TAB_LABELS[TEAM_INFO_TAB_KEYS.MEMBERS],
							children: (
								<TeamMembersComponent
									teamData={teamData}
									canEditTeam={canEditTeam}
									handleMemberDelete={handleMemberDelete}
									setSelectedEditMember={setSelectedEditMember}
									setIsEditMemberModalVisible={setIsEditMemberModalVisible}
									setIsAddMemberModalVisible={setIsAddMemberModalVisible}
								/>
							),
						},
						{
							key: TEAM_INFO_TAB_KEYS.MEMBER_PERMISSIONS,
							label: TEAM_INFO_TAB_LABELS[TEAM_INFO_TAB_KEYS.MEMBER_PERMISSIONS],
							children: <MemberPermissions teamId={teamId} accessToken={accessToken} canEditTeam={canEditTeam} />,
						},
						{
							key: TEAM_INFO_TAB_KEYS.SETTINGS,
							label: TEAM_INFO_TAB_LABELS[TEAM_INFO_TAB_KEYS.SETTINGS],
							children: (
								<TeamSettingsPanel
									form={form}
									info={info}
									teamId={teamId}
									userRole={userRole}
									accessToken={accessToken}
									guardrails={guardrailsList}
									policies={policiesList}
									premiumUser={premiumUser}
									canEdit={canEditTeam}
									editing={isEditing}
									saving={isTeamSaving}
									onEdit={() => setIsEditing(true)}
									onCancel={() => setIsEditing(false)}
									onSave={handleTeamUpdate}
								/>
							),
						},
					].filter((tab) => visibleTabs.includes(tab.key))}
				/>

				<TeamMemberDialogs
					accessToken={accessToken}
					teamId={teamId}
					editMemberOpen={isEditMemberModalVisible}
					selectedMember={selectedEditMember}
					addMemberOpen={isAddMemberModalVisible}
					deleteMemberOpen={isDeleteModalOpen}
					memberToDelete={memberToDelete}
					deleting={isDeleting}
					onEditMemberClose={() => setIsEditMemberModalVisible(false)}
					onEditMemberSubmit={handleMemberUpdate}
					onAddMemberClose={() => setIsAddMemberModalVisible(false)}
					onAddMemberSubmit={handleMemberCreate}
					onDeleteMemberClose={handleDeleteCancel}
					onDeleteMemberConfirm={handleDeleteConfirm}
				/>
			</div>
		</ResourceDetailsDrawer>
	);
};

export default TeamInfoView;
