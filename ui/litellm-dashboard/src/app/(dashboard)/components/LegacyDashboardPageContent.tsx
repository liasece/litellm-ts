import OldModelDashboard from "@/app/(dashboard)/models-and-endpoints/ModelsAndEndpointsView";
import PlaygroundPage from "@/app/(dashboard)/playground/page";
import AdminPanel from "@/components/AdminPanel";
import { AccessGroupsPage } from "@/components/AccessGroups/AccessGroupsPage";
import AgentsPanel from "@/components/agents";
import ModelHubTable from "@/components/AIHub/ModelHubTable";
import BudgetPanel from "@/components/budgets/budget_panel";
import CacheDashboard from "@/components/cache_dashboard";
import ClaudeCodePluginsPanel from "@/components/claude_code_plugins";
import { CostTrackingSettings } from "@/components/CostTrackingSettings";
import GeneralSettings from "@/components/general_settings";
import GuardrailsMonitorView from "@/components/GuardrailsMonitor/GuardrailsMonitorView";
import GuardrailsPanel from "@/components/guardrails";
import type { Team } from "@/components/key_team_helpers/key_list";
import { MCPServers } from "@/components/mcp_tools";
import type { Organization } from "@/components/networking";
import OldTeams from "@/components/OldTeams";
import type { CreateKeyPrefillData } from "@/components/organisms/create_key_button";
import Organizations from "@/components/organizations";
import PassThroughSettings from "@/components/pass_through_settings";
import PoliciesPanel from "@/components/policies";
import { ProjectsPage } from "@/components/Projects/ProjectsPage";
import PromptsPanel from "@/components/prompts";
import PublicModelHub from "@/components/public_model_hub";
import { SearchTools } from "@/components/SearchTools";
import Settings from "@/components/settings";
import TagManagement from "@/components/tag_management";
import ToolPoliciesView from "@/components/ToolPoliciesView";
import TransformRequestPanel from "@/components/transform_request";
import UIThemeSettings from "@/components/ui_theme_settings";
import NewUsagePage from "@/components/UsagePage/components/UsagePageView";
import Usage from "@/components/usage";
import UserDashboard from "@/components/user_dashboard";
import VectorStoreManagement from "@/components/vector_store_management";
import SpendLogsTable from "@/components/view_logs";
import ViewUserDashboard from "@/components/view_users";
import { isAdminRole } from "@/utils/roles";
import type { Dispatch, SetStateAction } from "react";

interface ProxySettings {
	PROXY_BASE_URL: string;
	PROXY_LOGOUT_URL: string;
	LITELLM_UI_API_DOC_BASE_URL?: string | null;
}

interface LegacyDashboardPageContentProps {
	page: string;
	userID: string | null;
	userRole: string;
	premiumUser: boolean;
	teams: Team[] | null;
	keys: any[] | null;
	setUserRole: Dispatch<SetStateAction<string>>;
	userEmail: string | null;
	setUserEmail: Dispatch<SetStateAction<string | null>>;
	setTeams: Dispatch<SetStateAction<Team[] | null>>;
	setKeys: Dispatch<SetStateAction<any[] | null>>;
	organizations: Organization[];
	setOrganizations: Dispatch<SetStateAction<Organization[]>>;
	addKey: (data: any) => void;
	createClicked: boolean;
	autoOpenCreate: boolean;
	prefillData?: CreateKeyPrefillData;
	token: string | null;
	modelData: any;
	setModelData: Dispatch<SetStateAction<any>>;
	accessToken: string | null;
	proxySettings: ProxySettings;
	userModels: string[];
}

export default function LegacyDashboardPageContent(props: LegacyDashboardPageContentProps) {
	const {
		page,
		userID,
		userRole,
		premiumUser,
		teams,
		keys,
		setUserRole,
		userEmail,
		setUserEmail,
		setTeams,
		setKeys,
		organizations,
		setOrganizations,
		addKey,
		createClicked,
		autoOpenCreate,
		prefillData,
		token,
		modelData,
		setModelData,
		accessToken,
		proxySettings,
		userModels,
	} = props;

	switch (page) {
		case "api-keys":
			return (
				<UserDashboard
					userID={userID}
					userRole={userRole}
					premiumUser={premiumUser}
					teams={teams}
					keys={keys}
					setUserRole={setUserRole}
					userEmail={userEmail}
					setUserEmail={setUserEmail}
					setTeams={setTeams}
					setKeys={setKeys}
					organizations={organizations}
					addKey={addKey}
					createClicked={createClicked}
					autoOpenCreate={autoOpenCreate}
					prefillData={prefillData}
				/>
			);
		case "models":
			return (
				<OldModelDashboard
					token={token}
					keys={keys}
					modelData={modelData}
					setModelData={setModelData}
					premiumUser={premiumUser}
					teams={teams}
				/>
			);
		case "llm-playground":
			return <PlaygroundPage />;
		case "users":
			return (
				<ViewUserDashboard
					userID={userID}
					userRole={userRole}
					token={token}
					keys={keys}
					teams={teams}
					accessToken={accessToken}
					setKeys={setKeys}
				/>
			);
		case "teams":
			return (
				<OldTeams
					teams={teams}
					setTeams={setTeams}
					accessToken={accessToken}
					userID={userID}
					userRole={userRole}
					organizations={organizations}
					premiumUser={premiumUser}
				/>
			);
		case "organizations":
			return (
				<Organizations
					organizations={organizations}
					setOrganizations={setOrganizations}
					userModels={userModels}
					accessToken={accessToken}
					userRole={userRole}
					premiumUser={premiumUser}
				/>
			);
		case "admin-panel":
			return <AdminPanel proxySettings={proxySettings} />;
		case "logging-and-alerts":
			return <Settings userID={userID} userRole={userRole} accessToken={accessToken} premiumUser={premiumUser} />;
		case "budgets":
			return <BudgetPanel accessToken={accessToken} />;
		case "guardrails":
			return <GuardrailsPanel accessToken={accessToken} userRole={userRole} />;
		case "policies":
			return <PoliciesPanel accessToken={accessToken} userRole={userRole} />;
		case "agents":
			return <AgentsPanel accessToken={accessToken} userRole={userRole} teams={teams} />;
		case "prompts":
			return <PromptsPanel accessToken={accessToken} userRole={userRole} />;
		case "transform-request":
			return <TransformRequestPanel accessToken={accessToken} />;
		case "router-settings":
			return (
				<GeneralSettings
					userID={userID}
					userRole={userRole}
					accessToken={accessToken}
					modelData={modelData}
				/>
			);
		case "ui-theme":
			return <UIThemeSettings userID={userID} userRole={userRole} accessToken={accessToken} />;
		case "cost-tracking":
			return <CostTrackingSettings userID={userID} userRole={userRole} accessToken={accessToken} />;
		case "model-hub-table":
			return isAdminRole(userRole) ? (
				<ModelHubTable
					accessToken={accessToken}
					publicPage={false}
					premiumUser={premiumUser}
					userRole={userRole}
				/>
			) : (
				<PublicModelHub accessToken={accessToken} isEmbedded />
			);
		case "caching":
			return (
				<CacheDashboard
					userID={userID}
					userRole={userRole}
					token={token}
					accessToken={accessToken}
					premiumUser={premiumUser}
				/>
			);
		case "pass-through-settings":
			return (
				<PassThroughSettings
					userID={userID}
					userRole={userRole}
					accessToken={accessToken}
					modelData={modelData}
					premiumUser={premiumUser}
				/>
			);
		case "logs":
			return (
				<SpendLogsTable
					userID={userID}
					userRole={userRole}
					token={token}
					accessToken={accessToken}
					allTeams={teams ?? []}
					premiumUser={premiumUser}
				/>
			);
		case "mcp-servers":
			return <MCPServers accessToken={accessToken} userRole={userRole} userID={userID} />;
		case "search-tools":
			return <SearchTools accessToken={accessToken} userRole={userRole} userID={userID} />;
		case "tag-management":
			return <TagManagement accessToken={accessToken} userRole={userRole} userID={userID} />;
		case "claude-code-plugins":
			return <ClaudeCodePluginsPanel accessToken={accessToken} userRole={userRole} />;
		case "access-groups":
			return <AccessGroupsPage />;
		case "projects":
			return <ProjectsPage />;
		case "vector-stores":
			return <VectorStoreManagement accessToken={accessToken} userRole={userRole} userID={userID} />;
		case "tool-policies":
			return <ToolPoliciesView accessToken={accessToken} userRole={userRole} />;
		case "guardrails-monitor":
			return <GuardrailsMonitorView accessToken={accessToken} />;
		case "new_usage":
			return <NewUsagePage teams={teams ?? []} organizations={organizations} />;
		default:
			return (
				<Usage
					userID={userID}
					userRole={userRole}
					token={token}
					accessToken={accessToken}
					keys={keys}
					premiumUser={premiumUser}
				/>
			);
	}
}
