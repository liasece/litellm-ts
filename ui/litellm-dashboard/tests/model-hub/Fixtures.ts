export const hubModels = [
	{
		model_group: "fixture-alpha",
		providers: ["openai"],
		mode: "chat",
		max_input_tokens: 128000,
		max_output_tokens: 4096,
		input_cost_per_token: 0.000002,
		output_cost_per_token: 0.000008,
		supports_vision: true,
		supports_function_calling: true,
		supports_parallel_function_calling: true,
		supported_openai_params: ["temperature", "tools"],
		tpm: 100000,
		rpm: 200,
		is_public_model_group: true,
		health_status: "healthy",
		health_response_time: 32,
		health_checked_at: "2026-11-07T01:00:00Z",
	},
	{
		model_group: "fixture-wildcard/*",
		providers: ["azure"],
		mode: "chat",
		max_input_tokens: 64000,
		max_output_tokens: 2048,
		input_cost_per_token: 0,
		output_cost_per_token: 0,
		supports_vision: true,
		is_public_model_group: true,
	},
	{
		model_group: "fixture-private",
		providers: ["cohere"],
		mode: "embedding",
		max_input_tokens: 8192,
		supports_function_calling: false,
		is_public_model_group: false,
	},
];
export const hubAgents = [
	{
		agent_id: "fixture-agent-id",
		protocolVersion: "0.3.0",
		name: "Fixture Research",
		description: "Search company reports and summarize sources",
		url: "https://agents.example.test/research",
		version: "1.2.0",
		capabilities: { streaming: true, pushNotifications: true },
		defaultInputModes: ["text"],
		defaultOutputModes: ["text", "json"],
		skills: [
			{
				id: "research",
				name: "Research",
				description: "Search published reports",
				tags: ["research", "reports"],
				examples: ["Find recent reports"],
			},
		],
		provider: { organization: "Fixture Company", url: "https://example.test" },
		documentationUrl: "https://docs.example.test/agent",
		supportsAuthenticatedExtendedCard: true,
		is_public: true,
	},
	{
		agent_id: "fixture-agent-private",
		protocolVersion: "0.3.0",
		name: "Fixture Code",
		description: "Review code",
		url: "https://agents.example.test/code",
		version: "1.0.0",
		capabilities: { streaming: true },
		defaultInputModes: ["text"],
		defaultOutputModes: ["text"],
		skills: [],
		is_public: false,
	},
];
export const hubServers = [
	{
		server_id: "fixture-server",
		server_name: "fixture-docs",
		alias: "Company Docs",
		name: "fixture-docs",
		description: "Search company knowledge",
		url: "https://mcp.example.test/docs",
		transport: "http",
		auth_type: "oauth2",
		status: "healthy",
		created_by: "fixture-admin",
		updated_by: "fixture-admin",
		created_at: "2026-11-06T02:00:00Z",
		updated_at: "2026-11-07T02:00:00Z",
		last_health_check: "2026-11-07T01:00:00Z",
		allowed_tools: ["search", "read", "list"],
		teams: ["fixture-team"],
		mcp_access_groups: ["company"],
		mcp_info: { server_name: "fixture-docs", description: "Search company knowledge", is_public: true },
	},
	{
		server_id: "fixture-server-private",
		server_name: "fixture-local",
		name: "fixture-local",
		description: "Local developer tools",
		url: "https://mcp.example.test/local",
		transport: "stdio",
		auth_type: "none",
		status: "inactive",
		created_by: "fixture-admin",
		updated_by: "fixture-admin",
		created_at: "2026-11-06T02:00:00Z",
		updated_at: "2026-11-07T02:00:00Z",
		allowed_tools: [],
		teams: [],
		mcp_access_groups: [],
		mcp_info: { server_name: "fixture-local", description: "Local developer tools", is_public: false },
	},
];
export const hubMarketplace = {
	name: "fixture-marketplace",
	owner: { name: "Fixture Company" },
	plugins: [
		{
			name: "fixture-development",
			source: { source: "github", repo: "fixture/dev-tools" },
			version: "1.0.0",
			description: "Testing and code tools",
			keywords: ["testing", "coding", "review", "tools"],
			category: "Development",
		},
		{
			name: "fixture-knowledge",
			source: { source: "url", url: "https://plugins.example.test/knowledge.json" },
			description: "Company knowledge helpers",
			keywords: ["research"],
			category: "Productivity",
		},
		{ name: "fixture-other", source: { source: "github", repo: "fixture/other" }, description: "Other tools", keywords: ["misc"] },
	],
};
export function fixtureForModelHub(path: string, method: string, body: Record<string, unknown> = {}): unknown | null {
	if (path === "/model_group/info") return { data: hubModels };
	if (path === "/v1/agents")
		return hubAgents.map((agent) => ({ agent_id: agent.agent_id, agent_card_params: agent, is_public: agent.is_public }));
	if (path === "/v1/mcp/server") return hubServers;
	if (path === "/public/model_hub") return hubModels.filter((model) => model.is_public_model_group);
	if (path === "/public/agent_hub") return hubAgents.filter((agent) => agent.is_public);
	if (path === "/public/mcp_hub") return hubServers.filter((server) => server.mcp_info.is_public);
	if (path === "/public/model_hub/info")
		return {
			custom_docs_description: "Company models, agents, and MCP tools.",
			litellm_version: "1.0.0-fixture",
			useful_links: { "Documentation": { url: "https://docs.example.test", index: 0 }, "Support": "https://support.example.test" },
		};
	if (path === "/claude-code/marketplace.json") return hubMarketplace;
	if (path === "/config/field/info") return { field_value: true };
	if (path === "/get/ui_settings") return { values: { require_auth_for_public_ai_hub: false } };
	if (path === "/get/ui_theme_settings") return { values: {} };
	if (path === "/auth/session") return { authenticated: true };
	if (
		method === "POST" &&
		["/model_group/make_public", "/v1/agents/make_public", "/v1/mcp/make_public", "/model_hub/update_useful_links"].includes(path)
	)
		return { status: "success", ...body };
	return null;
}
