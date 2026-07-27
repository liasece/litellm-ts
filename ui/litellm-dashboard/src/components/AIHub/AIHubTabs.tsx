import type { AgentHubData } from "@/components/AIHub/AgentHubTableColumns";
import { getAgentHubTableColumns } from "@/components/AIHub/AgentHubTableColumns";
import ClaudeCodeMarketplaceTab from "@/components/AIHub/ClaudeCodeMarketplaceTab";
import type { MCPServerData } from "@/components/mcp_hub_table_columns";
import { mcpHubColumns } from "@/components/mcp_hub_table_columns";
import { ModelDataTable } from "@/components/model_dashboard/table";
import ModelFilters from "@/components/model_filters";
import { modelHubColumns } from "@/components/model_hub_table_columns";
import { Button, Card, Tab, TabGroup, TabList, TabPanel, TabPanels, Text } from "@tremor/react";
import type { ModelGroupInfo } from "./types";

interface AIHubTabsProps {
	isAdmin: boolean;
	models: ModelGroupInfo[];
	filteredModels: ModelGroupInfo[];
	modelLoading: boolean;
	agents: AgentHubData[];
	agentLoading: boolean;
	mcpServers: MCPServerData[];
	mcpLoading: boolean;
	onFilteredModelsChange: (models: ModelGroupInfo[]) => void;
	onModelClick: (model: ModelGroupInfo) => void;
	onAgentClick: (agent: AgentHubData) => void;
	onMcpClick: (server: MCPServerData) => void;
	onCopy: (value: string) => void;
	onMakeModelsPublic: () => void;
	onMakeAgentsPublic: () => void;
	onMakeMcpPublic: () => void;
}

function HubCount({ children }: { children: React.ReactNode }) {
	return (
		<div className="mt-4 space-y-2 text-center">
			<Text className="text-sm text-gray-600">{children}</Text>
		</div>
	);
}

export default function AIHubTabs({
	isAdmin,
	models,
	filteredModels,
	modelLoading,
	agents,
	agentLoading,
	mcpServers,
	mcpLoading,
	onFilteredModelsChange,
	onModelClick,
	onAgentClick,
	onMcpClick,
	onCopy,
	onMakeModelsPublic,
	onMakeAgentsPublic,
	onMakeMcpPublic,
}: AIHubTabsProps) {
	return (
		<TabGroup>
			<TabList className="mb-4">
				<Tab>Model Hub</Tab>
				<Tab>Agent Hub</Tab>
				<Tab>MCP Hub</Tab>
				<Tab>Claude Code Plugin Marketplace</Tab>
			</TabList>
			<TabPanels>
				<TabPanel>
					<Card>
						{isAdmin && (
							<div className="mb-4 flex justify-end">
								<Button onClick={onMakeModelsPublic}>Select Models to Make Public</Button>
							</div>
						)}
						<ModelFilters modelHubData={models} onFilteredDataChange={onFilteredModelsChange} />
						<ModelDataTable
							columns={modelHubColumns(onModelClick, onCopy, false)}
							data={filteredModels}
							isLoading={modelLoading}
							defaultSorting={[{ id: "model_group", desc: false }]}
						/>
					</Card>
					<HubCount>
						Showing {filteredModels.length} of {models.length} models
					</HubCount>
				</TabPanel>

				<TabPanel>
					<Card>
						{isAdmin && (
							<div className="mb-4 flex justify-end">
								<Button onClick={onMakeAgentsPublic}>Select Agents to Make Public</Button>
							</div>
						)}
						<ModelDataTable
							columns={getAgentHubTableColumns(onAgentClick, onCopy, false)}
							data={agents}
							isLoading={agentLoading}
							defaultSorting={[{ id: "name", desc: false }]}
						/>
					</Card>
					<HubCount>
						Showing {agents.length} agent{agents.length !== 1 ? "s" : ""}
					</HubCount>
				</TabPanel>

				<TabPanel>
					<Card>
						{isAdmin && (
							<div className="mb-4 flex justify-end">
								<Button onClick={onMakeMcpPublic}>Select MCP Servers to Make Public</Button>
							</div>
						)}
						<ModelDataTable
							columns={mcpHubColumns(onMcpClick, onCopy, false)}
							data={mcpServers}
							isLoading={mcpLoading}
							defaultSorting={[{ id: "server_name", desc: false }]}
						/>
					</Card>
					<HubCount>
						Showing {mcpServers.length} MCP server{mcpServers.length !== 1 ? "s" : ""}
					</HubCount>
				</TabPanel>

				<TabPanel>
					<ClaudeCodeMarketplaceTab publicPage={false} />
				</TabPanel>
			</TabPanels>
		</TabGroup>
	);
}
