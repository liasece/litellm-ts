import type { HubAgent, HubMcp, HubModel } from "../support/ModelHubModels";
export function formatCapabilityName(key: string) {
	return key
		.replace(/^supports_/, "")
		.split("_")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}
export function modelCapabilities(model: HubModel) {
	return Object.entries(model)
		.filter(([key, value]) => key.startsWith("supports_") && value === true)
		.map(([key]) => key);
}
export function agentCapabilities(agent: HubAgent) {
	return Object.entries(agent.capabilities)
		.filter(([, value]) => value === true)
		.map(([key]) => key);
}
export function uniqueProviders(models: HubModel[]) {
	return [...new Set(models.flatMap((model) => model.providers))];
}
export function uniqueModes(models: HubModel[]) {
	return [...new Set(models.map((model) => model.mode).filter((mode): mode is string => Boolean(mode)))];
}
export function uniqueFeatures(models: HubModel[]) {
	return [...new Set(models.flatMap((model) => modelCapabilities(model).map(formatCapabilityName)))].sort();
}
export function uniqueSkills(agents: HubAgent[]) {
	return [...new Set(agents.flatMap((agent) => agent.skills.flatMap((skill) => skill.tags)))].sort();
}
export function uniqueTransports(servers: HubMcp[]) {
	return [...new Set(servers.map((server) => server.transport).filter(Boolean))].sort();
}
function score(name: string, query: string) {
	return (name === query ? 1000 : 0) + (name.startsWith(query) ? 100 : 0) + (1000 - name.length);
}
export function filterHubModels(
	models: HubModel[],
	search: string,
	providers: string[] = [],
	modes: string[] = [],
	features: string[] = [],
	rank = false,
) {
	const query = rank ? search.trim().toLowerCase() : search.toLowerCase(),
		words = query.split(/\s+/);
	let result = query
		? models.filter((model) => {
				const name = model.model_group.toLowerCase();
				return name.includes(query) || (rank && words.every((word) => name.includes(word)));
			})
		: models;
	if (query && rank)
		result = [...result].sort((a, b) => {
			const relevance = (name: string) =>
				score(name.toLowerCase(), query) + (words.every((word) => name.toLowerCase().includes(word)) ? 50 : 0);
			return relevance(b.model_group) - relevance(a.model_group);
		});
	return result.filter(
		(model) =>
			(!providers.length || model.providers.some((provider) => providers.includes(provider))) &&
			(!modes.length || modes.includes(model.mode ?? "")) &&
			(!features.length || features.some((feature) => modelCapabilities(model).map(formatCapabilityName).includes(feature))),
	);
}
export function filterHubAgents(agents: HubAgent[], search: string, skills: string[]) {
	const query = search.trim().toLowerCase(),
		words = query.split(/\s+/);
	let result = query
		? agents
				.filter((agent) => {
					const name = agent.name.toLowerCase(),
						description = agent.description.toLowerCase();
					return (
						name.includes(query) ||
						description.includes(query) ||
						words.every((word) => name.includes(word) || description.includes(word))
					);
				})
				.sort((a, b) => score(b.name.toLowerCase(), query) - score(a.name.toLowerCase(), query))
		: agents;
	result = result.filter((agent) => !skills.length || agent.skills.some((skill) => skill.tags.some((tag) => skills.includes(tag))));
	return result;
}
export function filterHubMcp(servers: HubMcp[], search: string, transports: string[]) {
	const query = search.trim().toLowerCase(),
		words = query.split(/\s+/);
	const result = query
		? servers
				.filter((server) => {
					const name = server.server_name.toLowerCase(),
						description = String(server.mcp_info.description ?? "").toLowerCase();
					return (
						name.includes(query) ||
						description.includes(query) ||
						words.every((word) => name.includes(word) || description.includes(word))
					);
				})
				.sort((a, b) => score(b.server_name.toLowerCase(), query) - score(a.server_name.toLowerCase(), query))
		: servers;
	return result.filter((server) => !transports.length || transports.includes(server.transport));
}
export function statusColor(status: string) {
	return ["active", "healthy"].includes(status) ? "green" : ["inactive", "unhealthy"].includes(status) ? "red" : "gray";
}
export function compactTokens(tokens: number) {
	return tokens >= 1000000 ? (tokens / 1000000).toFixed(1) + "M" : tokens >= 1000 ? (tokens / 1000).toFixed(1) + "K" : String(tokens);
}
export function publicTokens(tokens?: number | null) {
	return !tokens ? "N/A" : tokens >= 1000 ? (tokens / 1000).toFixed(0) + "K" : String(tokens);
}
