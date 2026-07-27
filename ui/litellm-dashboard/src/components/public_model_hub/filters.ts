import type {
	PublicAgentCard,
	PublicMcpServer,
	PublicModelInfo,
} from "./types";

export function formatCapabilityName(key: string) {
	return key
		.replace(/^supports_/, "")
		.split("_")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

export function getUniqueProviders(models: PublicModelInfo[]) {
	return Array.from(new Set(models.flatMap((model) => model.providers ?? [])));
}

export function getUniqueModes(models: PublicModelInfo[]) {
	return Array.from(
		new Set(models.map((model) => model.mode).filter((mode): mode is string => Boolean(mode))),
	);
}

export function getUniqueFeatures(models: PublicModelInfo[]) {
	return Array.from(
		new Set(
			models.flatMap((model) =>
				Object.entries(model)
					.filter(([key, value]) => key.startsWith("supports_") && value === true)
					.map(([key]) => formatCapabilityName(key)),
			),
		),
	).sort();
}

export function getUniqueAgentSkills(agents: PublicAgentCard[]) {
	return Array.from(
		new Set(
			agents.flatMap((agent) =>
				(agent.skills ?? []).flatMap((skill) => skill.tags ?? []),
			),
		),
	).sort();
}

export function getUniqueMcpTransports(servers: PublicMcpServer[]) {
	return Array.from(
		new Set(
			servers
				.map((server) => server.transport)
				.filter((transport): transport is string => Boolean(transport)),
		),
	).sort();
}

function relevanceScore(name: string, query: string) {
	return (
		(name === query ? 1000 : 0) +
		(name.startsWith(query) ? 100 : 0) +
		(1000 - name.length)
	);
}

function modelRelevanceScore(name: string, query: string) {
	return (
		relevanceScore(name, query) +
		(query.split(/\s+/).every((word) => name.includes(word)) ? 50 : 0)
	);
}

export function filterPublicModels(
	models: PublicModelInfo[],
	searchTerm: string,
	providers: string[],
	modes: string[],
	features: string[],
) {
	const query = searchTerm.trim().toLowerCase();
	let result = models;

	if (query) {
		const words = query.split(/\s+/);
		result = models
			.filter((model) => {
				const name = model.model_group.toLowerCase();
				return name.includes(query) || words.every((word) => name.includes(word));
			})
			.sort(
				(a, b) =>
					modelRelevanceScore(b.model_group.toLowerCase(), query) -
					modelRelevanceScore(a.model_group.toLowerCase(), query),
			);
	}

	return result.filter((model) => {
		const matchesProvider =
			providers.length === 0 ||
			model.providers?.some((provider) => providers.includes(provider));
		const matchesMode = modes.length === 0 || modes.includes(model.mode || "");
		const modelFeatures = Object.entries(model)
			.filter(([key, value]) => key.startsWith("supports_") && value === true)
			.map(([key]) => formatCapabilityName(key));
		const matchesFeatures =
			features.length === 0 ||
			features.some((feature) => modelFeatures.includes(feature));
		return matchesProvider && matchesMode && matchesFeatures;
	});
}

export function filterPublicAgents(
	agents: PublicAgentCard[],
	searchTerm: string,
	skills: string[],
) {
	const query = searchTerm.trim().toLowerCase();
	let result = agents;

	if (query) {
		const words = query.split(/\s+/);
		result = agents
			.filter((agent) => {
				const name = agent.name.toLowerCase();
				const description = agent.description.toLowerCase();
				return (
					name.includes(query) ||
					description.includes(query) ||
					words.every((word) => name.includes(word) || description.includes(word))
				);
			})
			.sort(
				(a, b) =>
					relevanceScore(b.name.toLowerCase(), query) -
					relevanceScore(a.name.toLowerCase(), query),
			);
	}

	return result.filter(
		(agent) =>
			skills.length === 0 ||
			agent.skills?.some((skill) =>
				skill.tags?.some((tag) => skills.includes(tag)),
			),
	);
}

export function filterPublicMcpServers(
	servers: PublicMcpServer[],
	searchTerm: string,
	transports: string[],
) {
	const query = searchTerm.trim().toLowerCase();
	let result = servers;

	if (query) {
		const words = query.split(/\s+/);
		result = servers
			.filter((server) => {
				const name = server.server_name.toLowerCase();
				const description = (server.mcp_info?.description || "").toLowerCase();
				return (
					name.includes(query) ||
					description.includes(query) ||
					words.every((word) => name.includes(word) || description.includes(word))
				);
			})
			.sort(
				(a, b) =>
					relevanceScore(b.server_name.toLowerCase(), query) -
					relevanceScore(a.server_name.toLowerCase(), query),
			);
	}

	return result.filter(
		(server) =>
			transports.length === 0 || transports.includes(server.transport),
	);
}
