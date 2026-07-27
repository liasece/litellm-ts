import { Button, Tab, TabGroup, TabList, TabPanel, TabPanels } from "@tremor/react";
import { rolesWithWriteAccess } from "@/utils/roles";
import React, { useCallback, useEffect, useState } from "react";
import ResourceDetailsDrawer from "../common_components/ResourceDetailsDrawer";
import NotificationsManager from "../molecules/notifications_manager";
import {
  getProxyBaseUrl,
  invitationCreateCall,
  type Member,
  modelAvailableCall,
  teamListCall,
  teamMemberAddCall,
  teamMemberDeleteCall,
  userDeleteCall,
  userGetInfoV2,
  type UserInfoV2Response,
  userUpdateUserCall,
} from "../networking";
import { copyToClipboard as utilCopyToClipboard } from "@/utils/dataUtils";
import UserDetailsHeader from "./details/UserDetailsHeader";
import UserManagementDialogs from "./dialogs/UserManagementDialogs";
import UserOverview from "./overview/UserOverview";
import UserSettingsPanel from "./settings/UserSettingsPanel";
import type { TeamDisplayInfo, TeamOption } from "./types";
import { fetchTeamDisplayInfo } from "./userDetailsUtils";
import type { InvitationLink } from "../onboarding_link";

interface UserInfoViewProps {
  userId: string;
  onClose: () => void;
  accessToken: string | null;
  userRole: string | null;
  onDelete?: () => void;
  possibleUIRoles: Record<string, Record<string, string>> | null;
  initialTab?: number;
  startInEditMode?: boolean;
}

export default function UserInfoView({
  userId,
  onClose,
  accessToken,
  userRole,
  onDelete,
  possibleUIRoles,
  initialTab = 0,
  startInEditMode = false,
}: UserInfoViewProps) {
  const [userData, setUserData] = useState<UserInfoV2Response | null>(null);
  const [teamDetails, setTeamDetails] = useState<TeamDisplayInfo[]>([]);
  const [userModels, setUserModels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(startInEditMode);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
  const [isTeamsExpanded, setIsTeamsExpanded] = useState(false);

  const [baseUrl, setBaseUrl] = useState("");
  const [invitationLinkData, setInvitationLinkData] = useState<InvitationLink | null>(null);
  const [isInvitationLinkModalVisible, setIsInvitationLinkModalVisible] = useState(false);

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState(false);

  const [isAddTeamModalOpen, setIsAddTeamModalOpen] = useState(false);
  const [isAddingTeam, setIsAddingTeam] = useState(false);
  const [allTeams, setAllTeams] = useState<TeamOption[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedRole, setSelectedRole] = useState("user");
  const [isLoadingTeams, setIsLoadingTeams] = useState(false);

  const [isRemoveTeamModalOpen, setIsRemoveTeamModalOpen] = useState(false);
  const [teamToRemove, setTeamToRemove] = useState<TeamDisplayInfo | null>(null);
  const [isRemovingTeam, setIsRemovingTeam] = useState(false);

  useEffect(() => {
    setBaseUrl(getProxyBaseUrl());
  }, []);

  const refreshUser = useCallback(async () => {
    if (!accessToken) return null;
    const data = await userGetInfoV2(accessToken, userId);
    setUserData(data);
    setTeamDetails(data.teams.length > 0 ? await fetchTeamDisplayInfo(accessToken, data.teams) : []);
    return data;
  }, [accessToken, userId]);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        if (!accessToken) return;
        await refreshUser();
        const modelDataResponse = await modelAvailableCall(accessToken, userId, userRole || "");
        setUserModels(modelDataResponse.data.map((model: { id: string }) => model.id));
      } catch {
        NotificationsManager.fromBackend("Failed to fetch user data");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [accessToken, refreshUser, userId, userRole]);

  const isProxyAdmin = userRole === "proxy_admin" || userRole === "Admin";
  const canManageUser = Boolean(userRole && rolesWithWriteAccess.includes(userRole));

  const handleOpenAddTeamModal = async () => {
    setSelectedTeamId("");
    setSelectedRole("user");
    setIsAddTeamModalOpen(true);
    if (!accessToken) return;
    setIsLoadingTeams(true);
    try {
      const teams = await teamListCall(accessToken, null);
      setAllTeams(
        (teams || []).map((team: { team_id: string; team_alias?: string | null }) => ({
          team_id: team.team_id,
          team_alias: team.team_alias || team.team_id,
        })),
      );
    } catch {
      NotificationsManager.fromBackend("Failed to fetch teams");
    } finally {
      setIsLoadingTeams(false);
    }
  };

  const handleAddTeamSubmit = async () => {
    if (!accessToken || !selectedTeamId) return;
    setIsAddingTeam(true);
    try {
      const member: Member = { role: selectedRole, user_id: userId };
      await teamMemberAddCall(accessToken, selectedTeamId, member);
      await refreshUser();
      NotificationsManager.success("User added to team successfully");
      setIsAddTeamModalOpen(false);
    } catch (error: any) {
      NotificationsManager.fromBackend(error?.message || "Failed to add user to team");
    } finally {
      setIsAddingTeam(false);
    }
  };

  const handleOpenRemoveTeamModal = (team: TeamDisplayInfo) => {
    setTeamToRemove(team);
    setIsRemoveTeamModalOpen(true);
  };

  const handleRemoveTeamConfirm = async () => {
    if (!accessToken || !teamToRemove) return;
    setIsRemovingTeam(true);
    try {
      const member: Member = { role: "user", user_id: userId };
      await teamMemberDeleteCall(accessToken, teamToRemove.team_id, member);
      await refreshUser();
      NotificationsManager.success("User removed from team successfully");
      setIsRemoveTeamModalOpen(false);
      setTeamToRemove(null);
    } catch (error: any) {
      NotificationsManager.fromBackend(error?.message || "Failed to remove user from team");
    } finally {
      setIsRemovingTeam(false);
    }
  };

  const handleResetPassword = async () => {
    if (!accessToken) {
      NotificationsManager.fromBackend("Access token not found");
      return;
    }
    try {
      NotificationsManager.success("Generating password reset link...");
      setInvitationLinkData(await invitationCreateCall(accessToken, userId));
      setIsInvitationLinkModalVisible(true);
    } catch {
      NotificationsManager.fromBackend("Failed to generate password reset link");
    }
  };

  const handleDelete = async () => {
    if (!accessToken) return;
    setIsDeletingUser(true);
    try {
      await userDeleteCall(accessToken, [userId]);
      NotificationsManager.success("User deleted successfully");
      onDelete?.();
      onClose();
    } catch {
      NotificationsManager.fromBackend("Failed to delete user");
    } finally {
      setIsDeleteModalOpen(false);
      setIsDeletingUser(false);
    }
  };

  const handleUserUpdate = async (formValues: Record<string, any>) => {
    if (!accessToken || !userData) return;
    try {
      await userUpdateUserCall(accessToken, formValues, null);
      const updatedValue = <T,>(field: string, currentValue: T): T =>
        Object.prototype.hasOwnProperty.call(formValues, field) ? formValues[field] : currentValue;
      setUserData({
        ...userData,
        user_email: updatedValue("user_email", userData.user_email),
        user_alias: updatedValue("user_alias", userData.user_alias),
        models: updatedValue("models", userData.models),
        max_budget: updatedValue("max_budget", userData.max_budget),
        budget_duration: updatedValue("budget_duration", userData.budget_duration),
        metadata: updatedValue("metadata", userData.metadata),
      });
      NotificationsManager.success("User updated successfully");
      setIsEditing(false);
    } catch {
      NotificationsManager.fromBackend("Failed to update user");
    }
  };

  const copyToClipboard = async (text: string, key: string) => {
    if (!(await utilCopyToClipboard(text))) return;
    setCopiedStates((previous) => ({ ...previous, [key]: true }));
    setTimeout(() => {
      setCopiedStates((previous) => ({ ...previous, [key]: false }));
    }, 2000);
  };

  if (isLoading) {
    return (
      <ResourceDetailsDrawer open onClose={onClose} title="User details" loading>
        <div>Loading user data...</div>
      </ResourceDetailsDrawer>
    );
  }

  if (!userData) {
    return (
      <ResourceDetailsDrawer open onClose={onClose} title="User details" error="User not found">
        <div>User not found</div>
      </ResourceDetailsDrawer>
    );
  }

  const handleCopyUserId = () => copyToClipboard(userData.user_id, "user-id");

  return (
    <ResourceDetailsDrawer
      open
      onClose={onClose}
      title={userData.user_email || "User"}
      subtitle={userData.user_id}
      actions={canManageUser ? <Button onClick={() => setIsEditing(true)}>Edit</Button> : undefined}
    >
      <div className="p-4">
        <UserDetailsHeader
          email={userData.user_email}
          userId={userData.user_id}
          canManage={canManageUser}
          copied={Boolean(copiedStates["user-id"])}
          onBack={onClose}
          onCopyUserId={handleCopyUserId}
          onResetPassword={handleResetPassword}
          onDelete={() => setIsDeleteModalOpen(true)}
        />

        <TabGroup defaultIndex={activeTab} onIndexChange={setActiveTab}>
          <TabList className="mb-4">
            <Tab>Overview</Tab>
            <Tab>Details</Tab>
          </TabList>
          <TabPanels>
            <TabPanel>
              <UserOverview
                user={userData}
                teams={teamDetails}
                canManageTeams={isProxyAdmin}
                teamsExpanded={isTeamsExpanded}
                onTeamsExpandedChange={setIsTeamsExpanded}
                onAddTeam={handleOpenAddTeamModal}
                onRemoveTeam={handleOpenRemoveTeamModal}
              />
            </TabPanel>
            <TabPanel>
              <UserSettingsPanel
                user={userData}
                teams={teamDetails}
                accessToken={accessToken}
                userRole={userRole}
                userModels={userModels}
                possibleUIRoles={possibleUIRoles}
                editing={isEditing}
                userIdCopied={Boolean(copiedStates["user-id"])}
                onEdit={() => setIsEditing(true)}
                onCancelEdit={() => setIsEditing(false)}
                onSubmit={handleUserUpdate}
                onCopyUserId={handleCopyUserId}
              />
            </TabPanel>
          </TabPanels>
        </TabGroup>

        <UserManagementDialogs
          user={userData}
          possibleUIRoles={possibleUIRoles}
          baseUrl={baseUrl}
          invitationOpen={isInvitationLinkModalVisible}
          invitationLink={invitationLinkData}
          deleteUserOpen={isDeleteModalOpen}
          deletingUser={isDeletingUser}
          addTeamOpen={isAddTeamModalOpen}
          allTeams={allTeams}
          currentTeams={teamDetails}
          selectedTeamId={selectedTeamId}
          selectedRole={selectedRole}
          loadingTeams={isLoadingTeams}
          addingTeam={isAddingTeam}
          removeTeamOpen={isRemoveTeamModalOpen}
          teamToRemove={teamToRemove}
          removingTeam={isRemovingTeam}
          onInvitationOpenChange={setIsInvitationLinkModalVisible}
          onDeleteUserCancel={() => setIsDeleteModalOpen(false)}
          onDeleteUserConfirm={handleDelete}
          onAddTeamCancel={() => setIsAddTeamModalOpen(false)}
          onAddTeamSubmit={handleAddTeamSubmit}
          onSelectedTeamChange={setSelectedTeamId}
          onSelectedRoleChange={setSelectedRole}
          onRemoveTeamCancel={() => {
            setIsRemoveTeamModalOpen(false);
            setTeamToRemove(null);
          }}
          onRemoveTeamConfirm={handleRemoveTeamConfirm}
        />
      </div>
    </ResourceDetailsDrawer>
  );
}
