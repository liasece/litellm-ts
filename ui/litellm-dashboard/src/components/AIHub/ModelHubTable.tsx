import { useUISettings } from "@/app/(dashboard)/hooks/uiSettings/useUISettings";
import type { AgentHubData } from "@/components/AIHub/AgentHubTableColumns";
import MakeAgentPublicForm from "@/components/AIHub/forms/MakeAgentPublicForm";
import MakeMCPPublicForm from "@/components/AIHub/forms/MakeMCPPublicForm";
import MakeModelPublicForm from "@/components/AIHub/forms/MakeModelPublicForm";
import UsefulLinksManagement from "@/components/AIHub/UsefulLinksManagement";
import type { MCPServerData } from "@/components/mcp_hub_table_columns";
import NotificationsManager from "@/components/molecules/notifications_manager";
import {
	fetchMCPServers,
	getAgentsList,
	getConfigFieldSetting,
	getProxyBaseUrl,
	getUiConfig,
	getWebUiSession,
	modelHubCall,
	modelHubPublicModelsCall,
} from "@/components/networking";
import PublicModelHub from "@/components/public_model_hub";
import { isAdminRole } from "@/utils/roles";
import { Card, Text } from "@tremor/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import AIHubHeader from "./AIHubHeader";
import AIHubTabs from "./AIHubTabs";
import ModelHubAgentDetailsModal from "./details/ModelHubAgentDetailsModal";
import ModelHubMcpDetailsModal from "./details/ModelHubMcpDetailsModal";
import ModelHubModelDetailsModal from "./details/ModelHubModelDetailsModal";
import type { ModelGroupInfo } from "./types";

interface ModelHubTableProps {
	accessToken: string | null;
	publicPage: boolean;
	premiumUser: boolean;
	userRole: string | null;
}

interface AgentApiRecord {
	agent_id?: string;
	agent_card_params?: Omit<AgentHubData, "agent_id" | "is_public">;
	litellm_params?: { is_public?: boolean };
	is_public?: boolean;
}

function mapAgentRecord(agent: AgentApiRecord): AgentHubData {
	return {
		agent_id: agent.agent_id,
		...agent.agent_card_params,
		is_public: agent.is_public ?? agent.litellm_params?.is_public,
	} as AgentHubData;
}

export default function ModelHubTable({
	accessToken,
	publicPage,
	userRole,
}: ModelHubTableProps) {
	const [publicPageAllowed, setPublicPageAllowed] = useState(false);
	const [models, setModels] = useState<ModelGroupInfo[]>([]);
	const [filteredModels, setFilteredModels] = useState<ModelGroupInfo[]>([]);
	const [modelLoading, setModelLoading] = useState(true);
	const [agents, setAgents] = useState<AgentHubData[]>([]);
	const [agentLoading, setAgentLoading] = useState(true);
	const [mcpServers, setMcpServers] = useState<MCPServerData[]>([]);
	const [mcpLoading, setMcpLoading] = useState(true);
	const [selectedModel, setSelectedModel] = useState<ModelGroupInfo | null>(null);
	const [selectedAgent, setSelectedAgent] = useState<AgentHubData | null>(null);
	const [selectedMcpServer, setSelectedMcpServer] = useState<MCPServerData | null>(null);
	const [showMakeModelsPublic, setShowMakeModelsPublic] = useState(false);
	const [showMakeAgentsPublic, setShowMakeAgentsPublic] = useState(false);
	const [showMakeMcpPublic, setShowMakeMcpPublic] = useState(false);
	const router = useRouter();
	const { data: uiSettings, isLoading: isUISettingsLoading } = useUISettings();
	const isAdmin = isAdminRole(userRole || "");

	useEffect(() => {
		if (isUISettingsLoading || !publicPage) return;
		if (uiSettings?.values?.require_auth_for_public_ai_hub === true) {
			void getWebUiSession().catch(() => {
				router.replace(`${getProxyBaseUrl()}/ui/login`);
			});
		}
	}, [isUISettingsLoading, publicPage, router, uiSettings]);

	const refreshModels = useCallback(async () => {
		if (!accessToken) return;
		const response = await modelHubCall(accessToken);
		setModels(response.data);
	}, [accessToken]);

	const refreshAgents = useCallback(async () => {
		if (!accessToken) return;
		const response = await getAgentsList(accessToken);
		setAgents((response.agents as AgentApiRecord[]).map(mapAgentRecord));
	}, [accessToken]);

	const refreshMcpServers = useCallback(async () => {
		if (!accessToken) return;
		setMcpServers(await fetchMCPServers(accessToken));
	}, [accessToken]);

	useEffect(() => {
		const loadModels = async () => {
			setModelLoading(true);
			try {
				if (accessToken) {
					await refreshModels();
					try {
						const setting = await getConfigFieldSetting(
							accessToken,
							"enable_public_model_hub",
						);
						setPublicPageAllowed(setting.field_value === true);
					} catch {
						setPublicPageAllowed(false);
					}
				} else if (publicPage) {
					await getUiConfig();
					setModels(await modelHubPublicModelsCall());
					setPublicPageAllowed(true);
				} else {
					setModels([]);
				}
			} catch {
				setModels([]);
				setPublicPageAllowed(false);
			} finally {
				setModelLoading(false);
			}
		};

		void loadModels();
	}, [accessToken, publicPage, refreshModels]);

	useEffect(() => {
		if (publicPage || !accessToken) {
			return;
		}

		const loadResources = async () => {
			setAgentLoading(true);
			setMcpLoading(true);
			await Promise.all([
				refreshAgents().catch(() => setAgents([])).finally(() => setAgentLoading(false)),
				refreshMcpServers()
					.catch(() => setMcpServers([]))
					.finally(() => setMcpLoading(false)),
			]);
		};

		void loadResources();
	}, [accessToken, publicPage, refreshAgents, refreshMcpServers]);

	const copyToClipboard = (value: string) => {
		void navigator.clipboard.writeText(value);
		NotificationsManager.success("Copied to clipboard!");
	};

	if (publicPage && publicPageAllowed) {
		return <PublicModelHub accessToken={accessToken} />;
	}

	if (publicPage) {
		return (
			<Card className="mx-auto mt-10 max-w-xl">
				<Text className="mb-2 text-center text-xl text-black">
					Public Model Hub not enabled.
				</Text>
				<p className="text-center text-base text-slate-800">
					Ask your proxy admin to enable this on their Admin UI.
				</p>
			</Card>
		);
	}

	return (
		<div className="mx-4 h-[75vh] w-full">
			<div className="m-2 mt-2 w-full p-8">
				<AIHubHeader isAdmin={isAdmin} onCopy={copyToClipboard} />
				{isAdmin && (
					<div className="mb-2 mt-8">
						<UsefulLinksManagement accessToken={accessToken} userRole={userRole} />
					</div>
				)}
				<AIHubTabs
					isAdmin={isAdmin}
					models={models}
					filteredModels={filteredModels}
					modelLoading={modelLoading}
					agents={accessToken ? agents : []}
					agentLoading={Boolean(accessToken) && agentLoading}
					mcpServers={accessToken ? mcpServers : []}
					mcpLoading={Boolean(accessToken) && mcpLoading}
					onFilteredModelsChange={setFilteredModels}
					onModelClick={setSelectedModel}
					onAgentClick={setSelectedAgent}
					onMcpClick={setSelectedMcpServer}
					onCopy={copyToClipboard}
					onMakeModelsPublic={() => setShowMakeModelsPublic(true)}
					onMakeAgentsPublic={() => setShowMakeAgentsPublic(true)}
					onMakeMcpPublic={() => setShowMakeMcpPublic(true)}
				/>
			</div>

			<ModelHubModelDetailsModal
				model={selectedModel}
				open={selectedModel !== null}
				onClose={() => setSelectedModel(null)}
			/>
			<ModelHubAgentDetailsModal
				agent={selectedAgent}
				open={selectedAgent !== null}
				onClose={() => setSelectedAgent(null)}
				onCopy={copyToClipboard}
			/>
			<ModelHubMcpDetailsModal
				server={selectedMcpServer}
				open={selectedMcpServer !== null}
				onClose={() => setSelectedMcpServer(null)}
				onCopy={copyToClipboard}
			/>

			<MakeModelPublicForm
				visible={showMakeModelsPublic}
				onClose={() => setShowMakeModelsPublic(false)}
				accessToken={accessToken || ""}
				modelHubData={models}
				onSuccess={() => void refreshModels()}
			/>
			<MakeAgentPublicForm
				visible={showMakeAgentsPublic}
				onClose={() => setShowMakeAgentsPublic(false)}
				accessToken={accessToken || ""}
				agentHubData={agents}
				onSuccess={() => void refreshAgents()}
			/>
			<MakeMCPPublicForm
				visible={showMakeMcpPublic}
				onClose={() => setShowMakeMcpPublic(false)}
				accessToken={accessToken || ""}
				mcpHubData={mcpServers}
				onSuccess={() => void refreshMcpServers()}
			/>
		</div>
	);
}
