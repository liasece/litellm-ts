import ProviderLogo from "@/components/common_components/ProviderLogo";
import { ModelDataTable } from "@/components/model_dashboard/table";
import { getProviderLogoAndName } from "@/components/provider_info_helpers";
import { SearchIcon } from "@heroicons/react/outline";
import { Card, Text, Title } from "@tremor/react";
import { Select, Tabs, Tooltip } from "antd";
import { Info } from "lucide-react";
import { useMemo, useState } from "react";
import {
	getPublicAgentColumns,
	getPublicMcpColumns,
	getPublicModelColumns,
} from "./columns";
import {
	filterPublicAgents,
	filterPublicMcpServers,
	filterPublicModels,
	getUniqueAgentSkills,
	getUniqueFeatures,
	getUniqueMcpTransports,
	getUniqueModes,
	getUniqueProviders,
} from "./filters";
import type {
	PublicAgentCard,
	PublicMcpServer,
	PublicModelInfo,
} from "./types";

interface PublicHubTabsProps {
	models: PublicModelInfo[];
	agents: PublicAgentCard[];
	mcpServers: PublicMcpServer[];
	modelLoading: boolean;
	agentLoading: boolean;
	mcpLoading: boolean;
	onModelSelect: (model: PublicModelInfo) => void;
	onAgentSelect: (agent: PublicAgentCard) => void;
	onMcpSelect: (server: PublicMcpServer) => void;
	onCopy: (value: string) => void;
}

function SearchField({
	label,
	tooltip,
	placeholder,
	value,
	onChange,
}: {
	label: string;
	tooltip: string;
	placeholder: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<div>
			<div className="mb-3 flex items-center space-x-2">
				<Text className="text-sm font-medium text-gray-700">{label}</Text>
				<Tooltip title={tooltip} placement="top">
					<Info className="h-4 w-4 cursor-help text-gray-400" />
				</Tooltip>
			</div>
			<div className="relative">
				<SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
				<input
					type="text"
					placeholder={placeholder}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
			</div>
		</div>
	);
}

function MultiSelect({
	label,
	value,
	options,
	placeholder,
	onChange,
	renderProvider = false,
}: {
	label: string;
	value: string[];
	options: string[];
	placeholder: string;
	onChange: (values: string[]) => void;
	renderProvider?: boolean;
}) {
	return (
		<div>
			<Text className="mb-3 text-sm font-medium text-gray-700">{label}</Text>
			<Select
				mode="multiple"
				value={value}
				onChange={onChange}
				placeholder={placeholder}
				className="w-full"
				size="large"
				allowClear
				optionRender={
					renderProvider
						? (option) => {
								const provider = String(option.value);
								const { logo } = getProviderLogoAndName(provider);
								return (
									<div className="flex items-center space-x-2">
										<ProviderLogo
											provider={provider}
											logo={logo}
											className="h-5 w-5 flex-shrink-0 object-contain"
											fallbackClassName="hidden"
										/>
										<span className="capitalize">{String(option.label)}</span>
									</div>
								);
							}
						: undefined
				}
				options={options.map((option) => ({ label: option, value: option }))}
			/>
		</div>
	);
}

export default function PublicHubTabs({
	models,
	agents,
	mcpServers,
	modelLoading,
	agentLoading,
	mcpLoading,
	onModelSelect,
	onAgentSelect,
	onMcpSelect,
	onCopy,
}: PublicHubTabsProps) {
	const [activeTab, setActiveTab] = useState("models");
	const [modelSearch, setModelSearch] = useState("");
	const [agentSearch, setAgentSearch] = useState("");
	const [mcpSearch, setMcpSearch] = useState("");
	const [providers, setProviders] = useState<string[]>([]);
	const [modes, setModes] = useState<string[]>([]);
	const [features, setFeatures] = useState<string[]>([]);
	const [agentSkills, setAgentSkills] = useState<string[]>([]);
	const [mcpTransports, setMcpTransports] = useState<string[]>([]);

	const filteredModels = useMemo(
		() => filterPublicModels(models, modelSearch, providers, modes, features),
		[features, modelSearch, models, modes, providers],
	);
	const filteredAgents = useMemo(
		() => filterPublicAgents(agents, agentSearch, agentSkills),
		[agentSearch, agentSkills, agents],
	);
	const filteredMcpServers = useMemo(
		() => filterPublicMcpServers(mcpServers, mcpSearch, mcpTransports),
		[mcpSearch, mcpServers, mcpTransports],
	);
	const modelColumns = useMemo(() => getPublicModelColumns(onModelSelect), [onModelSelect]);
	const agentColumns = useMemo(() => getPublicAgentColumns(onAgentSelect), [onAgentSelect]);
	const mcpColumns = useMemo(
		() => getPublicMcpColumns(onMcpSelect, onCopy),
		[onCopy, onMcpSelect],
	);

	return (
		<Card className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
			<Tabs
				activeKey={activeTab}
				onChange={setActiveTab}
				size="large"
				className="public-hub-tabs"
				items={[
					{
						key: "models",
						label: "Model Hub",
						children: (
							<>
								<Title className="mb-8 text-2xl font-semibold text-gray-900">
									Available Models
								</Title>
								<div className="mb-8 grid grid-cols-1 gap-6 rounded-lg border border-gray-200 bg-gray-50 p-6 md:grid-cols-2 lg:grid-cols-4">
									<SearchField
										label="Search Models:"
										tooltip="Smart search with relevance ranking for model names."
										placeholder="Search model names..."
										value={modelSearch}
										onChange={setModelSearch}
									/>
									<MultiSelect
										label="Provider:"
										value={providers}
										options={getUniqueProviders(models)}
										placeholder="Select providers"
										onChange={setProviders}
										renderProvider
									/>
									<MultiSelect
										label="Mode:"
										value={modes}
										options={getUniqueModes(models)}
										placeholder="Select modes"
										onChange={setModes}
									/>
									<MultiSelect
										label="Features:"
										value={features}
										options={getUniqueFeatures(models)}
										placeholder="Select features"
										onChange={setFeatures}
									/>
								</div>
								<ModelDataTable
									columns={modelColumns}
									data={filteredModels}
									isLoading={modelLoading}
									defaultSorting={[{ id: "model_group", desc: false }]}
								/>
								<Text className="mt-8 text-center text-sm text-gray-600">
									Showing {filteredModels.length} of {models.length} models
								</Text>
							</>
						),
					},
					...(agents.length
						? [
								{
									key: "agents",
									label: "Agent Hub",
									children: (
										<>
											<Title className="mb-8 text-2xl font-semibold text-gray-900">
												Available Agents
											</Title>
											<div className="mb-8 grid grid-cols-1 gap-6 rounded-lg border border-gray-200 bg-gray-50 p-6 md:grid-cols-2">
												<SearchField
													label="Search Agents:"
													tooltip="Search agents by name or description"
													placeholder="Search agent names or descriptions..."
													value={agentSearch}
													onChange={setAgentSearch}
												/>
												<MultiSelect
													label="Skills:"
													value={agentSkills}
													options={getUniqueAgentSkills(agents)}
													placeholder="Select skills"
													onChange={setAgentSkills}
												/>
											</div>
											<ModelDataTable
												columns={agentColumns}
												data={filteredAgents}
												isLoading={agentLoading}
												defaultSorting={[{ id: "name", desc: false }]}
											/>
											<Text className="mt-8 text-center text-sm text-gray-600">
												Showing {filteredAgents.length} of {agents.length} agents
											</Text>
										</>
									),
								},
							]
						: []),
					...(mcpServers.length
						? [
								{
									key: "mcp",
									label: "MCP Hub",
									children: (
										<>
											<Title className="mb-8 text-2xl font-semibold text-gray-900">
												Available MCP Servers
											</Title>
											<div className="mb-8 grid grid-cols-1 gap-6 rounded-lg border border-gray-200 bg-gray-50 p-6 md:grid-cols-2">
												<SearchField
													label="Search MCP Servers:"
													tooltip="Search MCP servers by name or description"
													placeholder="Search MCP server names or descriptions..."
													value={mcpSearch}
													onChange={setMcpSearch}
												/>
												<MultiSelect
													label="Transport:"
													value={mcpTransports}
													options={getUniqueMcpTransports(mcpServers)}
													placeholder="Select transport types"
													onChange={setMcpTransports}
												/>
											</div>
											<ModelDataTable
												columns={mcpColumns}
												data={filteredMcpServers}
												isLoading={mcpLoading}
												defaultSorting={[{ id: "server_name", desc: false }]}
											/>
											<Text className="mt-8 text-center text-sm text-gray-600">
												Showing {filteredMcpServers.length} of {mcpServers.length} MCP servers
											</Text>
										</>
									),
								},
							]
						: []),
				]}
			/>
		</Card>
	);
}

