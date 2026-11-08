export const uiSettingFields = [
	{ name: "disable_model_add_for_internal_users", label: "Disable model add for internal users" },
	{ name: "disable_team_admin_delete_team_user", label: "Disable team admin delete team user" },
	{ name: "require_auth_for_public_ai_hub", label: "Require authentication for public AI Hub" },
	{
		name: "forward_client_headers_to_llm_api",
		label: "Forward client headers to LLM API",
		description:
			"If enabled, forwards client headers (e.g. Authorization) to the LLM API. Required for Claude Code with Max subscription.",
	},
	{
		name: "enable_projects_ui",
		label: "[BETA] Enable Projects (page will refresh)",
		ariaLabel: "Enable Projects UI",
		description: "If enabled, shows the Projects feature in the UI sidebar and the project field in key management.",
	},
	{ name: "disable_agents_for_internal_users", label: "Disable agents for internal users", divider: true },
	{ name: "allow_agents_for_team_admins", label: "Allow agents for team admins", parent: "disable_agents_for_internal_users" },
	{ name: "disable_vector_stores_for_internal_users", label: "Disable vector stores for internal users", divider: true },
	{
		name: "allow_vector_stores_for_team_admins",
		label: "Allow vector stores for team admins",
		parent: "disable_vector_stores_for_internal_users",
	},
	{
		name: "scope_user_search_to_org",
		label: "Scope user search to organization",
		description:
			"If enabled, the user search endpoint restricts results by organization. When off, any authenticated user can search all users.",
		divider: true,
	},
	{
		name: "disable_custom_api_keys",
		label: "Disable custom Virtual key values",
		description: "If true, users cannot specify custom key values. All keys must be auto-generated.",
		divider: true,
	},
] as const;
