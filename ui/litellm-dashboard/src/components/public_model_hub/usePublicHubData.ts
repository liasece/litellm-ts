import {
	agentHubPublicModelsCall,
	getPublicModelHubInfo,
	getUiConfig,
	mcpHubPublicServersCall,
	modelHubPublicModelsCall,
} from "@/components/networking";
import { useEffect, useState } from "react";
import type { PublicAgentCard, PublicMcpServer, PublicModelInfo, UsefulLinks } from "./types";

export default function usePublicHubData() {
	const [models, setModels] = useState<PublicModelInfo[]>([]);
	const [agents, setAgents] = useState<PublicAgentCard[]>([]);
	const [mcpServers, setMcpServers] = useState<PublicMcpServer[]>([]);
	const [description, setDescription] = useState<string | null>(null);
	const [version, setVersion] = useState("");
	const [usefulLinks, setUsefulLinks] = useState<UsefulLinks>({});
	const [modelLoading, setModelLoading] = useState(true);
	const [agentLoading, setAgentLoading] = useState(true);
	const [mcpLoading, setMcpLoading] = useState(true);
	const [serviceStatus, setServiceStatus] = useState("I'm alive! ✓");

	useEffect(() => {
		let active = true;

		const initialize = async () => {
			try {
				await getUiConfig();
			} catch {
				// Public endpoints can still work with the default proxy base URL.
			}

			await Promise.allSettled([
				modelHubPublicModelsCall()
					.then((response) => {
						if (active) setModels(Array.isArray(response) ? response : []);
					})
					.catch(() => {
						if (active) {
							setModels([]);
							setServiceStatus("Service unavailable");
						}
					})
					.finally(() => {
						if (active) setModelLoading(false);
					}),
				agentHubPublicModelsCall()
					.then((response) => {
						if (active) setAgents(Array.isArray(response) ? response : []);
					})
					.catch(() => {
						if (active) setAgents([]);
					})
					.finally(() => {
						if (active) setAgentLoading(false);
					}),
				mcpHubPublicServersCall()
					.then((response) => {
						if (active) setMcpServers(Array.isArray(response) ? response : []);
					})
					.catch(() => {
						if (active) setMcpServers([]);
					})
					.finally(() => {
						if (active) setMcpLoading(false);
					}),
				getPublicModelHubInfo()
					.then((info) => {
						if (!active) return;
						setDescription(info.custom_docs_description);
						setVersion(info.litellm_version);
						setUsefulLinks(info.useful_links || {});
					})
					.catch(() => undefined),
			]);
		};

		void initialize();
		return () => {
			active = false;
		};
	}, []);

	return {
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
	};
}
