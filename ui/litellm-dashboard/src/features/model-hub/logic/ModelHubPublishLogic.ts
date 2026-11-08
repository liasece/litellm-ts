import type { HubAgent, HubMcp, HubModel, HubPublishItem, HubPublishKind } from "../support/ModelHubModels";
import { statusColor } from "./ModelHubFilterLogic";
export function publishModels(models: HubModel[]): HubPublishItem[] {
	return models.map((model) => ({
		id: model.model_group,
		name: model.model_group,
		public: model.is_public_model_group === true,
		description: "",
		badges: [
			...(model.mode ? [{ label: model.mode, color: "green" }] : []),
			...model.providers.map((label) => ({ label, color: "blue" })),
		],
	}));
}
export function publishAgents(agents: HubAgent[]): HubPublishItem[] {
	return agents.map((agent) => ({
		id: agent.agent_id || agent.name,
		name: agent.name,
		public: agent.is_public === true,
		description: agent.description,
		badges: [
			{ label: "v" + agent.version, color: "blue" },
			...agent.skills.slice(0, 3).map((skill) => ({ label: skill.name, color: "purple" })),
		],
		extra: agent.skills.length > 3 ? "+" + (agent.skills.length - 3) + " more" : undefined,
	}));
}
export function publishMcp(servers: HubMcp[]): HubPublishItem[] {
	return servers.map((server) => ({
		id: server.server_id,
		name: server.server_name,
		public: server.mcp_info.is_public === true,
		description: server.description || server.url,
		confirmationDescription: server.description ?? undefined,
		url: server.url,
		badges: [
			...(server.mcp_info.is_public === true ? [{ label: "Public", color: "emerald" }] : []),
			{ label: server.transport, color: "blue" },
			{ label: server.status || "unknown", color: statusColor(server.status) },
			...server.allowed_tools.slice(0, 3).map((label) => ({ label, color: "purple" })),
		],
		extra: server.allowed_tools.length > 3 ? "+" + (server.allowed_tools.length - 3) + " more" : undefined,
	}));
}
export const publishingText = {
	models: {
		title: "Models",
		singular: "model",
		plural: "models",
		select: "Select Models",
		noun: "model groups",
		success: "model group(s)",
		empty: "No models match the current filters.",
	},
	agents: {
		title: "Agents",
		singular: "agent",
		plural: "agents",
		select: "Select Agents",
		noun: "agents",
		success: "agent(s)",
		empty: "No agents available.",
	},
	mcp: {
		title: "MCP Servers",
		singular: "MCP server",
		plural: "MCP servers",
		select: "Select Servers",
		noun: "MCP servers",
		success: "MCP server(s)",
		empty: "No MCP servers available.",
	},
} satisfies Record<HubPublishKind, Record<string, string>>;
