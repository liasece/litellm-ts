import { ThemeProvider } from "@/contexts/ThemeContext";
import { useState } from "react";
import NotificationsManager from "./molecules/notifications_manager";
import Navbar from "./navbar";
import PublicHubIntroSections from "./public_model_hub/PublicHubIntroSections";
import PublicHubTabs from "./public_model_hub/PublicHubTabs";
import PublicAgentDetailsModal from "./public_model_hub/details/PublicAgentDetailsModal";
import PublicMcpDetailsModal from "./public_model_hub/details/PublicMcpDetailsModal";
import PublicModelDetailsModal from "./public_model_hub/details/PublicModelDetailsModal";
import type {
	PublicAgentCard as AgentCard,
	PublicMcpServer as MCPServerData,
	PublicModelInfo as ModelGroupInfo,
} from "./public_model_hub/types";
import usePublicHubData from "./public_model_hub/usePublicHubData";

interface PublicModelHubProps {
	accessToken?: string | null;
	isEmbedded?: boolean; // When true, hides navbar and adjusts layout for embedding in dashboard
}

const PublicModelHub = ({ accessToken, isEmbedded = false }: PublicModelHubProps) => {
	const {
		models,
		agents,
		mcpServers,
		description,
		version,
		usefulLinks,
		modelLoading,
		agentLoading,
		mcpLoading,
		serviceStatus,
	} = usePublicHubData();
	const [selectedModel, setSelectedModel] = useState<null | ModelGroupInfo>(null);
	const [selectedAgent, setSelectedAgent] = useState<null | AgentCard>(null);
	const [selectedMcpServer, setSelectedMcpServer] = useState<null | MCPServerData>(null);
	const [proxySettings, setProxySettings] = useState<any>({});

	const copyToClipboard = (text: string) => {
		void navigator.clipboard.writeText(text);
		NotificationsManager.success("Copied to clipboard!");
	};

	return (
		<ThemeProvider accessToken={accessToken}>
			<div className={isEmbedded ? "w-full" : "min-h-screen bg-white"}>
				{/* Navigation - only show when not embedded */}
				{!isEmbedded && (
					<Navbar
						userID={null}
						userEmail={null}
						userRole={null}
						premiumUser={false}
						setProxySettings={setProxySettings}
						proxySettings={proxySettings}
						accessToken={accessToken || null}
						isPublicPage={true}
						isDarkMode={false}
						toggleDarkMode={() => {}}
					/>
				)}

				<div className={isEmbedded ? "w-full p-6" : "w-full px-8 py-12"}>
					<PublicHubIntroSections
						embedded={isEmbedded}
						description={description}
						version={version}
						usefulLinks={usefulLinks}
						serviceStatus={serviceStatus}
					/>
					<PublicHubTabs
						models={models}
						agents={agents}
						mcpServers={mcpServers}
						modelLoading={modelLoading}
						agentLoading={agentLoading}
						mcpLoading={mcpLoading}
						onModelSelect={setSelectedModel}
						onAgentSelect={setSelectedAgent}
						onMcpSelect={setSelectedMcpServer}
						onCopy={copyToClipboard}
					/>
				</div>

				<PublicModelDetailsModal
					model={selectedModel}
					open={selectedModel !== null}
					onClose={() => setSelectedModel(null)}
					onCopy={copyToClipboard}
				/>
				<PublicAgentDetailsModal
					agent={selectedAgent}
					open={selectedAgent !== null}
					onClose={() => setSelectedAgent(null)}
					onCopy={copyToClipboard}
				/>
				<PublicMcpDetailsModal
					server={selectedMcpServer}
					open={selectedMcpServer !== null}
					onClose={() => setSelectedMcpServer(null)}
					onCopy={copyToClipboard}
				/>
			</div>
		</ThemeProvider>
	);
};

export default PublicModelHub;
