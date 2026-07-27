import { useResetKeySpend } from "@/app/(dashboard)/hooks/keys/useResetKeySpend";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { useProjects } from "@/app/(dashboard)/hooks/projects/useProjects";
import { useUISettings } from "@/app/(dashboard)/hooks/uiSettings/useUISettings";
import useTeams from "@/app/(dashboard)/hooks/useTeams";
import { Button, Tab, TabGroup, TabList, TabPanel, TabPanels } from "@tremor/react";
import { useEffect, useState } from "react";
import { isProxyAdminRole, isUserTeamAdminForSingleTeam, rolesWithWriteAccess } from "../../utils/roles";
import ResourceDetailsDrawer from "../common_components/ResourceDetailsDrawer";
import KeyActionDialogs from "../key_details/KeyActionDialogs";
import { formatKeyTimestamp } from "../key_details/formatKeyTimestamp";
import KeyOverview from "../key_details/KeyOverview";
import KeySettingsSummary from "../key_details/KeySettingsSummary";
import { buildKeyUpdatePayload } from "../key_details/keyUpdatePayload";
import type { KeyResponse } from "../key_team_helpers/key_list";
import NotificationManager from "../molecules/notifications_manager";
import { getPolicyInfoWithGuardrails, keyDeleteCall, keyUpdateCall } from "../networking";
import { parseErrorMessage } from "../shared/errorUtils";
import { KeyInfoHeader } from "./KeyInfoHeader";

interface KeyInfoViewProps {
	keyId: string;
	onClose: () => void;
	keyData: KeyResponse | undefined;
	onKeyDataUpdate?: (data: Partial<KeyResponse>) => void;
	onDelete?: () => void;
	teams: any[] | null;
	backButtonText?: string;
}

export default function KeyInfoView({ onClose, keyData, teams, onKeyDataUpdate, onDelete }: KeyInfoViewProps) {
	const { accessToken, userId: userID, userRole, premiumUser } = useAuthorized();
	const { teams: teamsData } = useTeams();
	const { data: projects } = useProjects();
	const { data: uiSettingsData } = useUISettings();
	const { mutate: resetKeySpend, isPending: resetSpendLoading } = useResetKeySpend();

	const [currentKeyData, setCurrentKeyData] = useState<KeyResponse | undefined>(keyData);
	const [isEditing, setIsEditing] = useState(false);
	const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
	const [deleteLoading, setDeleteLoading] = useState(false);
	const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false);
	const [isResetSpendModalOpen, setIsResetSpendModalOpen] = useState(false);
	const [lastRegeneratedAt, setLastRegeneratedAt] = useState<Date | null>(null);
	const [isRecentlyRegenerated, setIsRecentlyRegenerated] = useState(false);
	const [policyGuardrails, setPolicyGuardrails] = useState<Record<string, string[]>>({});
	const [loadingPolicies, setLoadingPolicies] = useState(false);

	const canEditGuardrails = premiumUser || (userRole != null && rolesWithWriteAccess.includes(userRole));
	const enableProjectsUI = Boolean(uiSettingsData?.values?.enable_projects_ui);

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- Reset the editable local copy when the selected key changes.
		if (keyData) setCurrentKeyData(keyData);
	}, [keyData]);

	useEffect(() => {
		const fetchPolicyGuardrails = async () => {
			const policies = currentKeyData?.metadata?.policies;
			if (!accessToken || !Array.isArray(policies) || policies.length === 0) {
				setPolicyGuardrails({});
				return;
			}

			setLoadingPolicies(true);
			const resolvedGuardrails: Record<string, string[]> = {};
			try {
				await Promise.all(
					policies.map(async (policyValue) => {
						const policyName = String(policyValue);
						try {
							const policyInfo = await getPolicyInfoWithGuardrails(accessToken, policyName);
							resolvedGuardrails[policyName] = policyInfo.resolved_guardrails || [];
						} catch (error) {
							console.error(`Failed to fetch guardrails for policy ${policyName}:`, error);
							resolvedGuardrails[policyName] = [];
						}
					}),
				);
				setPolicyGuardrails(resolvedGuardrails);
			} finally {
				setLoadingPolicies(false);
			}
		};

		fetchPolicyGuardrails();
	}, [accessToken, currentKeyData?.metadata?.policies]);

	useEffect(() => {
		if (!isRecentlyRegenerated) return;
		const timer = setTimeout(() => setIsRecentlyRegenerated(false), 5000);
		return () => clearTimeout(timer);
	}, [isRecentlyRegenerated]);

	if (!currentKeyData) {
		return (
			<ResourceDetailsDrawer open onClose={onClose} title="Virtual Key" error="Key not found">
				<div />
			</ResourceDetailsDrawer>
		);
	}

	const handleKeyUpdate = async (formValues: Record<string, any>) => {
		if (!accessToken) return;
		try {
			const payload = buildKeyUpdatePayload(formValues, currentKeyData, canEditGuardrails);
			const newKeyValues = await keyUpdateCall(accessToken, payload);
			setCurrentKeyData((previous) => (previous ? { ...previous, ...newKeyValues } : undefined));
			onKeyDataUpdate?.(newKeyValues);
			NotificationManager.success("Key updated successfully");
			setIsEditing(false);
		} catch (error) {
			if (error instanceof SyntaxError) {
				NotificationManager.error("Invalid metadata JSON");
				return;
			}
			NotificationManager.fromBackend(parseErrorMessage(error));
			console.error("Error updating key:", error);
		}
	};

	const handleDelete = async () => {
		setDeleteLoading(true);
		try {
			if (!accessToken) return;
			await keyDeleteCall(accessToken, currentKeyData.token || currentKeyData.token_id);
			NotificationManager.success("Key deleted successfully");
			onDelete?.();
			onClose();
		} catch (error) {
			console.error("Error deleting the key:", error);
			NotificationManager.fromBackend(error);
		} finally {
			setDeleteLoading(false);
			setIsDeleteModalOpen(false);
		}
	};

	const handleRegenerateKeyUpdate = (updatedKeyData: Partial<KeyResponse>) => {
		const regeneratedAt = new Date();
		const createdAt = regeneratedAt.toLocaleString();
		setCurrentKeyData((previous) => (previous ? { ...previous, ...updatedKeyData, created_at: createdAt } : undefined));
		setLastRegeneratedAt(regeneratedAt);
		setIsRecentlyRegenerated(true);
		onKeyDataUpdate?.({ ...updatedKeyData, created_at: createdAt });
	};

	const teamMembers = teamsData?.find((team) => team.team_id === currentKeyData.team_id)?.members_with_roles;
	const isTeamAdmin = Boolean(teamsData && isUserTeamAdminForSingleTeam(teamMembers ?? null, userID || ""));
	const canModifyKey =
		isProxyAdminRole(userRole || "") ||
		isTeamAdmin ||
		(userID === currentKeyData.user_id && userRole !== "Internal Viewer");
	const canResetSpend = isProxyAdminRole(userRole || "") || isTeamAdmin;

	const handleResetSpend = () => {
		resetKeySpend(currentKeyData.token || currentKeyData.token_id, {
			onSuccess: () => {
				setCurrentKeyData((previous) => (previous ? { ...previous, spend: 0 } : undefined));
				onKeyDataUpdate?.({ spend: 0 });
				NotificationManager.success("Key spend reset to $0");
				setIsResetSpendModalOpen(false);
			},
			onError: (error) => {
				NotificationManager.fromBackend(parseErrorMessage(error));
				console.error("Error resetting key spend:", error);
			},
		});
	};

	return (
		<>
			<ResourceDetailsDrawer
				open
				onClose={() => {
					setIsEditing(false);
					onClose();
				}}
				title={`Virtual Key: ${currentKeyData.key_alias || "Virtual Key"}`}
				subtitle={currentKeyData.token_id || currentKeyData.token}
				actions={
					canModifyKey ? (
						<Button variant="primary" onClick={() => setIsEditing(true)}>
							Edit
						</Button>
					) : undefined
				}
			>
				<div className="p-4">
					<KeyInfoHeader
						data={{
							keyName: currentKeyData.key_alias || "Virtual Key",
							keyId: currentKeyData.token_id || currentKeyData.token,
							userId: currentKeyData.user_id || "",
							userEmail: currentKeyData.user_email || "",
							createdBy: currentKeyData.user_email || currentKeyData.user_id || "",
							createdAt: currentKeyData.created_at ? formatKeyTimestamp(currentKeyData.created_at) : "",
							lastUpdated: currentKeyData.updated_at ? formatKeyTimestamp(currentKeyData.updated_at) : "",
							lastActive: currentKeyData.last_active ? formatKeyTimestamp(currentKeyData.last_active) : "Never",
						}}
						onRegenerate={() => setIsRegenerateModalOpen(true)}
						onDelete={() => setIsDeleteModalOpen(true)}
						onResetSpend={canResetSpend ? () => setIsResetSpendModalOpen(true) : undefined}
						canModifyKey={canModifyKey}
						regenerateDisabled={!premiumUser}
						regenerateTooltip={
							!premiumUser ? "This is a LiteLLM Enterprise feature, and requires a valid key to use." : undefined
						}
					/>

					<TabGroup>
						<TabList className="mb-4">
							<Tab>Overview</Tab>
							<Tab>Settings</Tab>
						</TabList>
						<TabPanels>
							<TabPanel>
								<KeyOverview
									keyData={currentKeyData}
									accessToken={accessToken}
									policyGuardrails={policyGuardrails}
									loadingPolicies={loadingPolicies}
								/>
							</TabPanel>
							<TabPanel>
								<KeySettingsSummary
									keyData={currentKeyData}
									accessToken={accessToken}
									projects={projects}
									enableProjectsUI={enableProjectsUI}
									lastRegeneratedAt={lastRegeneratedAt}
									recentlyRegenerated={isRecentlyRegenerated}
								/>
							</TabPanel>
						</TabPanels>
					</TabGroup>
				</div>
			</ResourceDetailsDrawer>

			<KeyActionDialogs
				keyData={currentKeyData}
				teams={teams}
				accessToken={accessToken}
				userId={userID}
				userRole={userRole}
				premiumUser={premiumUser}
				editing={isEditing}
				regenerateOpen={isRegenerateModalOpen}
				deleteOpen={isDeleteModalOpen}
				deleteLoading={deleteLoading}
				resetSpendOpen={isResetSpendModalOpen}
				resetSpendLoading={resetSpendLoading}
				onEditClose={() => setIsEditing(false)}
				onEditSubmit={handleKeyUpdate}
				onRegenerateClose={() => setIsRegenerateModalOpen(false)}
				onRegenerateUpdate={handleRegenerateKeyUpdate}
				onDeleteClose={() => setIsDeleteModalOpen(false)}
				onDeleteConfirm={handleDelete}
				onResetSpendClose={() => setIsResetSpendModalOpen(false)}
				onResetSpendConfirm={handleResetSpend}
			/>
		</>
	);
}
