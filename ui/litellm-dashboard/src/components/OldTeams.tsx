import { useOrganizations } from "@/app/(dashboard)/hooks/organizations/useOrganizations";
import TeamInfoView from "@/components/team/TeamInfo";
import { isProxyAdminRole } from "@/utils/roles";
import { PlusOutlined, TeamOutlined } from "@ant-design/icons";
import { Button, Flex, Form, Layout, Space, theme, Typography } from "antd";
import type { SorterResult } from "antd/es/table/interface";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { teamListCall as v2TeamListCall, type TeamsResponse } from "@/app/(dashboard)/hooks/teams/useTeams";
import type { RouterSettingsAccordionValue } from "./common_components/RouterSettingsAccordion";
import { fetchAvailableModelsForTeamOrKey } from "./key_team_helpers/fetch_available_models_team_key";
import type { KeyResponse, Team } from "./key_team_helpers/key_list";
import NotificationsManager from "./molecules/notifications_manager";
import { Organization, getGuardrailsList, getPoliciesList, teamDeleteCall } from "./networking";

interface TeamProps {
	teams: Team[] | null;
	accessToken: string | null;
	setTeams: React.Dispatch<React.SetStateAction<Team[] | null>>;
	userID: string | null;
	userRole: string | null;
	organizations: Organization[] | null;
	premiumUser?: boolean;
}

interface FilterState {
	team_id: string;
	team_alias: string;
	organization_id: string;
	sort_by: string;
	sort_order: "asc" | "desc";
}

import { updateExistingKeys } from "@/utils/dataUtils";
import { Member, teamCreateCall } from "./networking";
import TeamsListPanel from "./team/list/TeamsListPanel";
import useTeamColumns from "./team/list/useTeamColumns";
import CreateTeamModal from "./team/create/CreateTeamModal";

interface TeamInfo {
	members_with_roles: Member[];
}

interface PerTeamInfo {
	keys: KeyResponse[];
	team_info: TeamInfo;
}

const canCreateOrManageTeams = (
	userRole: string | null,
	userID: string | null,
	organizations: Organization[] | null,
): boolean => {
	// Admin role always has permission
	if (userRole === "Admin") {
		return true;
	}

	// Check if user is an org_admin in any organization
	if (organizations && userID) {
		return organizations.some((org) =>
			org.members?.some((member) => member.user_id === userID && member.user_role === "org_admin"),
		);
	}

	return false;
};

const getAdminOrganizations = (
	userRole: string | null,
	userID: string | null,
	organizations: Organization[] | null,
): Organization[] => {
	// Global Admin can see all organizations
	if (userRole === "Admin") {
		return organizations || [];
	}

	// Org Admin can only see organizations they're an admin for
	if (organizations && userID) {
		return organizations.filter((org) =>
			org.members?.some((member) => member.user_id === userID && member.user_role === "org_admin"),
		);
	}

	return [];
};

// @deprecated
const Teams: React.FC<TeamProps> = ({
	teams,
	accessToken,
	setTeams,
	userID,
	userRole,
	organizations,
	premiumUser = false,
}) => {
	const { data: organizationsData } = useOrganizations();
	const [isLoading, setIsLoading] = useState(true);
	const [fetchError, setFetchError] = useState<string | null>(null);
	const [currentPage, setCurrentPage] = useState(1);
	const [pageSize, setPageSize] = useState(10);
	const [totalTeams, setTotalTeams] = useState(0);
	const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
	const [createOrganizationId, setCreateOrganizationId] = useState<string | null>(null);
	const [filters, setFilters] = useState<FilterState>({
		team_id: "",
		team_alias: "",
		organization_id: "",
		sort_by: "created_at",
		sort_order: "desc",
	});
	const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [isSearching, setIsSearching] = useState(false);

	const fetchTeamsV2 = async (
		opts: {
			page?: number;
			size?: number;
			sortBy?: string;
			sortOrder?: string;
			organizationID?: string;
			teamAlias?: string;
		} = {},
	) => {
		if (!accessToken) return;
		const page = opts.page ?? currentPage;
		const size = opts.size ?? pageSize;
		const sortBy = opts.sortBy ?? filters.sort_by;
		const sortOrder = opts.sortOrder ?? filters.sort_order;
		const organizationID = opts.organizationID ?? filters.organization_id;
		const teamAlias = opts.teamAlias ?? filters.team_alias;

		setIsLoading(true);
		setFetchError(null);
		try {
			const response: TeamsResponse = await v2TeamListCall(accessToken, page, size, {
				organizationID: organizationID || null,
				team_alias: teamAlias || null,
				userID: userRole !== "Admin" && userRole !== "Admin Viewer" ? userID : null,
				sortBy: sortBy || null,
				sortOrder: sortOrder || null,
			});
			setTeams(response.teams ?? []);
			setTotalTeams(response.total ?? 0);
		} catch (err: any) {
			setFetchError(err?.message || "Failed to fetch teams");
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		void fetchTeamsV2();
		// Filters and pagination trigger their own requests; this effect only reacts to authentication changes.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [accessToken]);

	const [form] = Form.useForm();
	const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
	const [editTeam, setEditTeam] = useState<boolean>(false);

	const [isTeamModalVisible, setIsTeamModalVisible] = useState(false);
	const [userModels, setUserModels] = useState<string[]>([]);
	const [teamToDelete, setTeamToDelete] = useState<Team | null>(null);
	const [perTeamInfo, setPerTeamInfo] = useState<Record<string, PerTeamInfo>>({});
	const [isTeamDeleting, setIsTeamDeleting] = useState(false);
	// Add this state near the other useState declarations
	const [guardrailsList, setGuardrailsList] = useState<string[]>([]);
	const [policiesList, setPoliciesList] = useState<string[]>([]);
	const [loggingSettings, setLoggingSettings] = useState<any[]>([]);
	const [modelAliases, setModelAliases] = useState<{ [key: string]: string }>({});
	const [routerSettings, setRouterSettings] = useState<RouterSettingsAccordionValue | null>(null);
	const [routerSettingsKey, setRouterSettingsKey] = useState<number>(0);

	// Handle organization preselection when modal opens
	useEffect(() => {
		if (isTeamModalVisible) {
			const adminOrgs = getAdminOrganizations(userRole, userID, organizations);

			// If there's exactly one organization the user is admin for, preselect it
			if (adminOrgs.length === 1) {
				const org = adminOrgs[0];
				form.setFieldValue("organization_id", org.organization_id);
				setCreateOrganizationId(org.organization_id);
			} else {
				// Reset the organization selection for multiple orgs
				form.setFieldValue("organization_id", currentOrg?.organization_id || null);
				setCreateOrganizationId(currentOrg?.organization_id || null);
			}
		}
	}, [form, isTeamModalVisible, userRole, userID, organizations, currentOrg]);

	// Add this useEffect to fetch guardrails
	useEffect(() => {
		const fetchGuardrails = async () => {
			try {
				if (accessToken == null) {
					return;
				}

				const response = await getGuardrailsList(accessToken);
				const guardrailNames = response.guardrails.map((g: { guardrail_name: string }) => g.guardrail_name);
				setGuardrailsList(guardrailNames);
			} catch {
				NotificationsManager.fromBackend("Failed to load guardrails");
			}
		};

		const fetchPolicies = async () => {
			try {
				if (accessToken == null) {
					return;
				}

				const response = await getPoliciesList(accessToken);
				const policyNames = response.policies.map((p: { policy_name: string }) => p.policy_name);
				setPoliciesList(policyNames);
			} catch {
				NotificationsManager.fromBackend("Failed to load policies");
			}
		};

		fetchGuardrails();
		fetchPolicies();
	}, [accessToken]);

	useEffect(() => {
		const fetchTeamInfo = () => {
			if (!teams) return;

			const newPerTeamInfo = teams.reduce(
				(acc, team) => {
					acc[team.team_id] = {
						keys: team.keys || [],
						team_info: {
							members_with_roles: team.members_with_roles || [],
						},
					};
					return acc;
				},
				{} as Record<string, PerTeamInfo>,
			);

			setPerTeamInfo(newPerTeamInfo);
		};

		fetchTeamInfo();
	}, [teams]);

	const handleCancel = () => {
		setIsTeamModalVisible(false);
		form.resetFields();
		setLoggingSettings([]);
		setModelAliases({});
		setRouterSettings(null);
		setRouterSettingsKey((prev) => prev + 1);
	};

	const handleDelete = async (team: Team) => {
		setTeamToDelete(team);
	};

	const confirmDelete = async () => {
		if (teamToDelete == null || teams == null || accessToken == null) {
			return;
		}

		try {
			setIsTeamDeleting(true);
			await teamDeleteCall(accessToken, teamToDelete.team_id);
			await fetchTeamsV2();
			NotificationsManager.success("Team deleted successfully");
		} catch (error) {
			NotificationsManager.fromBackend("Error deleting the team: " + error);
		} finally {
			setIsTeamDeleting(false);
			setTeamToDelete(null);
		}
	};

	const cancelDelete = () => {
		setTeamToDelete(null);
	};

	useEffect(() => {
		const fetchUserModels = async () => {
			try {
				if (userID === null || userRole === null || accessToken === null) {
					return;
				}
				const models = await fetchAvailableModelsForTeamOrKey(userID, userRole, accessToken);
				if (models) {
					setUserModels(models);
				}
			} catch {
				NotificationsManager.fromBackend("Failed to load available models");
			}
		};

		fetchUserModels();
	}, [accessToken, userID, userRole, teams]);

	const handleCreate = async (formValues: Record<string, any>) => {
		try {
			if (accessToken != null) {
				const newTeamAlias = formValues?.team_alias;
				const existingTeamAliases = teams?.map((t) => t.team_alias) ?? [];
				let organizationId = formValues?.organization_id || currentOrg?.organization_id;
				if (organizationId === "" || typeof organizationId !== "string") {
					formValues.organization_id = null;
				} else {
					formValues.organization_id = organizationId.trim();
				}

				// Remove guardrails from top level since it's now in metadata
				if (existingTeamAliases.includes(newTeamAlias)) {
					throw new Error(`Team alias ${newTeamAlias} already exists, please pick another alias`);
				}

				NotificationsManager.info("Creating Team");

				// Handle logging settings in metadata
				if (loggingSettings.length > 0) {
					let metadata = {};
					if (formValues.metadata) {
						try {
							metadata = JSON.parse(formValues.metadata);
						} catch {
							// Preserve the existing behavior: invalid optional metadata starts from an empty object.
						}
					}

					// Add logging settings to metadata
					metadata = {
						...metadata,
						logging: loggingSettings.filter((config) => config.callback_name), // Only include configs with callback_name
					};

					formValues.metadata = JSON.stringify(metadata);
				}

				if (formValues.secret_manager_settings) {
					if (typeof formValues.secret_manager_settings === "string") {
						if (formValues.secret_manager_settings.trim() === "") {
							delete formValues.secret_manager_settings;
						} else {
							try {
								formValues.secret_manager_settings = JSON.parse(formValues.secret_manager_settings);
							} catch (e) {
								throw new Error("Failed to parse secret manager settings: " + e);
							}
						}
					}
				}

				// Transform allowed_vector_store_ids and allowed_mcp_servers_and_groups into object_permission
				if (
					(formValues.allowed_vector_store_ids && formValues.allowed_vector_store_ids.length > 0) ||
					(formValues.allowed_mcp_servers_and_groups &&
						(formValues.allowed_mcp_servers_and_groups.servers?.length > 0 ||
							formValues.allowed_mcp_servers_and_groups.accessGroups?.length > 0 ||
							formValues.allowed_mcp_servers_and_groups.toolPermissions))
				) {
					formValues.object_permission = {};
					if (formValues.allowed_vector_store_ids && formValues.allowed_vector_store_ids.length > 0) {
						formValues.object_permission.vector_stores = formValues.allowed_vector_store_ids;
						delete formValues.allowed_vector_store_ids;
					}
					if (formValues.allowed_mcp_servers_and_groups) {
						const { servers, accessGroups } = formValues.allowed_mcp_servers_and_groups;
						if (servers && servers.length > 0) {
							formValues.object_permission.mcp_servers = servers;
						}
						if (accessGroups && accessGroups.length > 0) {
							formValues.object_permission.mcp_access_groups = accessGroups;
						}
						delete formValues.allowed_mcp_servers_and_groups;
					}

					// Add tool permissions separately
					if (formValues.mcp_tool_permissions && Object.keys(formValues.mcp_tool_permissions).length > 0) {
						if (!formValues.object_permission) {
							formValues.object_permission = {};
						}
						formValues.object_permission.mcp_tool_permissions = formValues.mcp_tool_permissions;
						delete formValues.mcp_tool_permissions;
					}
				}

				// Transform allowed_mcp_access_groups into object_permission
				if (formValues.allowed_mcp_access_groups && formValues.allowed_mcp_access_groups.length > 0) {
					if (!formValues.object_permission) {
						formValues.object_permission = {};
					}
					formValues.object_permission.mcp_access_groups = formValues.allowed_mcp_access_groups;
					delete formValues.allowed_mcp_access_groups;
				}

				// Handle agent permissions
				if (formValues.allowed_agents_and_groups) {
					const { agents, accessGroups } = formValues.allowed_agents_and_groups;
					if (!formValues.object_permission) {
						formValues.object_permission = {};
					}
					if (agents && agents.length > 0) {
						formValues.object_permission.agents = agents;
					}
					if (accessGroups && accessGroups.length > 0) {
						formValues.object_permission.agent_access_groups = accessGroups;
					}
					delete formValues.allowed_agents_and_groups;
				}

				// Add model_aliases if any are defined
				if (Object.keys(modelAliases).length > 0) {
					formValues.model_aliases = modelAliases;
				}

				// Add router_settings if any are defined
				if (routerSettings?.router_settings) {
					// Only include router_settings if it has at least one non-null value
					const hasValues = Object.values(routerSettings.router_settings).some(
						(value) => value !== null && value !== undefined && value !== "",
					);
					if (hasValues) {
						formValues.router_settings = routerSettings.router_settings;
					}
				}

				await teamCreateCall(accessToken, formValues);
				NotificationsManager.success("Team created");
				await fetchTeamsV2({
					page: currentPage,
					size: pageSize,
				});
				form.resetFields();
				setLoggingSettings([]);
				setModelAliases({});
				setRouterSettings(null);
				setRouterSettingsKey((prev) => prev + 1);
				setIsTeamModalVisible(false);
			}
		} catch (error) {
			NotificationsManager.fromBackend("Error creating the team: " + error);
		}
	};

	const is_team_admin = (team: any) => {
		if (team == null || team.members_with_roles == null) {
			return false;
		}
		for (let i = 0; i < team.members_with_roles.length; i++) {
			let member = team.members_with_roles[i];
			if (member.user_id == userID && member.role == "admin") {
				return true;
			}
		}
		return false;
	};

	const handleSearchChange = (value: string) => {
		if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
		setIsSearching(true);
		searchDebounceRef.current = setTimeout(async () => {
			try {
				setFilters((prev) => ({ ...prev, team_alias: value }));
				setCurrentPage(1);
				await fetchTeamsV2({ page: 1, teamAlias: value });
			} finally {
				setIsSearching(false);
			}
		}, 300);
	};

	const handleFilterChange = async (key: keyof FilterState, value: string) => {
		const newFilters = { ...filters, [key]: value };
		setFilters(newFilters);
		setCurrentPage(1);
		if (!accessToken) return;
		try {
			const response: TeamsResponse = await v2TeamListCall(accessToken, 1, pageSize, {
				organizationID: newFilters.organization_id || null,
				team_alias: newFilters.team_alias || null,
				userID: userRole !== "Admin" && userRole !== "Admin Viewer" ? userID : null,
				sortBy: newFilters.sort_by || null,
				sortOrder: newFilters.sort_order || null,
			});
			setTeams(response.teams ?? []);
			setTotalTeams(response.total ?? 0);
		} catch {
			NotificationsManager.fromBackend("Failed to load teams");
		}
	};

	const handleFilterReset = () => {
		if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
		setIsSearching(false);
		const resetFilters: FilterState = {
			team_id: "",
			team_alias: "",
			organization_id: "",
			sort_by: "created_at",
			sort_order: "desc",
		};
		setFilters(resetFilters);
		setCurrentPage(1);
		fetchTeamsV2({ page: 1, organizationID: "", teamAlias: "", sortBy: "created_at", sortOrder: "desc" });
	};

	const { token } = theme.useToken();
	const { Title, Text } = Typography;
	const { Content } = Layout;

	const handleRetry = () => {
		fetchTeamsV2();
	};

	const handleTableSort = (
		_pagination: unknown,
		_filters: unknown,
		sorter: SorterResult<Team> | SorterResult<Team>[],
	) => {
		const s = Array.isArray(sorter) ? sorter[0] : sorter;
		const sortBy = s.order ? (s.columnKey as string) : "created_at";
		const sortOrder = s.order === "ascend" ? "asc" : s.order === "descend" ? "desc" : "desc";
		setFilters((prev) => ({ ...prev, sort_by: sortBy, sort_order: sortOrder }));
		fetchTeamsV2({ sortBy, sortOrder });
	};

	const teamColumns = useTeamColumns({
		userRole,
		organizations: organizationsData || organizations,
		perTeamInfo,
		onOpen: (teamId, edit) => {
			setSelectedTeamId(teamId);
			setEditTeam(edit);
		},
		onDelete: handleDelete,
	});
	const displayTeams = useMemo(() => teams ?? [], [teams]);

	return (
		<Content style={{ padding: token.paddingLG, paddingInline: token.paddingLG * 2 }}>
			{selectedTeamId ? (
				<TeamInfoView
					teamId={selectedTeamId}
					onUpdate={(data) => {
						setTeams((teams) => {
							if (teams == null) {
								return teams;
							}
							return teams.map((team) => {
								if (data.team_id === team.team_id) {
									return updateExistingKeys(team, data);
								}
								return team;
							});
						});
						fetchTeamsV2();
					}}
					onClose={() => {
						setSelectedTeamId(null);
						setEditTeam(false);
					}}
					accessToken={accessToken}
					is_team_admin={is_team_admin(teams?.find((team) => team.team_id === selectedTeamId))}
					is_proxy_admin={userRole == "Admin"}
					userModels={userModels}
					editTeam={editTeam}
					premiumUser={premiumUser}
				/>
			) : (
				<>
					<Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
						<Space direction="vertical" size={0}>
							<Title level={2} style={{ margin: 0 }}>
								<TeamOutlined style={{ marginRight: 8 }} />
								Teams
							</Title>
							<Text type="secondary">Manage teams, members, and their access to models and budgets</Text>
						</Space>
						{canCreateOrManageTeams(userRole, userID, organizations) && (
							<Button type="primary" icon={<PlusOutlined />} onClick={() => setIsTeamModalVisible(true)}>
								Create Team
							</Button>
						)}
					</Flex>

					<TeamsListPanel
						teams={displayTeams}
						columns={teamColumns}
						loading={isLoading}
						searching={isSearching}
						error={fetchError}
						organizations={organizations}
						organizationId={filters.organization_id}
						currentPage={currentPage}
						pageSize={pageSize}
						totalTeams={totalTeams}
						canCreate={canCreateOrManageTeams(userRole, userID, organizations)}
						accessToken={accessToken}
						userId={userID}
						userRole={userRole}
						showAdminSettings={isProxyAdminRole(userRole || "")}
						teamToDelete={teamToDelete}
						deleting={isTeamDeleting}
						onSearch={handleSearchChange}
						onOrganizationChange={(organizationId) => handleFilterChange("organization_id", organizationId)}
						onPageChange={(page, size) => {
							setCurrentPage(page);
							setPageSize(size);
							void fetchTeamsV2({ page, size });
						}}
						onSort={handleTableSort}
						onRetry={handleRetry}
						onCreate={() => setIsTeamModalVisible(true)}
						onDeleteCancel={cancelDelete}
						onDeleteConfirm={confirmDelete}
					/>
				</>
			)}

			{canCreateOrManageTeams(userRole, userID, organizations) && (
				<CreateTeamModal
					open={isTeamModalVisible}
					form={form}
					userRole={userRole}
					userId={userID}
					organizations={organizations}
					currentOrganizationId={currentOrg?.organization_id || null}
					selectedOrganizationId={createOrganizationId}
					premiumUser={premiumUser}
					accessToken={accessToken}
					guardrails={guardrailsList}
					policies={policiesList}
					loggingSettings={loggingSettings}
					routerSettings={routerSettings}
					routerSettingsKey={routerSettingsKey}
					userModels={userModels}
					modelAliases={modelAliases}
					onOrganizationChange={setCreateOrganizationId}
					onLoggingSettingsChange={setLoggingSettings}
					onRouterSettingsChange={setRouterSettings}
					onModelAliasesChange={setModelAliases}
					onSubmit={handleCreate}
					onCancel={handleCancel}
				/>
			)}
		</Content>
	);
};

export default Teams;
