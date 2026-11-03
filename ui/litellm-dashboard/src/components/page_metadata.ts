/**
 * Page metadata for UI Settings configuration
 * This file contains descriptions and metadata for all navigation pages
 */

// Page descriptions for UI Settings configuration
export const pageDescriptions: Record<string, string> = {
	"api-keys": "Manage virtual keys for API access and authentication",
	"llm-playground": "Interactive playground for testing LLM requests",
	models: "Configure and manage LLM models and endpoints",
	"mcp-servers": "Configure Model Context Protocol servers",
	"search-tools": "Configure RAG search and retrieval tools",
	new_usage: "View usage analytics and metrics",
	logs: "Access request and response logs",
	speed: "Compare model output token speed (TPS) over time",
	users: "Manage internal user accounts and permissions",
	teams: "Create and manage teams for access control",
	organizations: "Manage organizations and their members",
	projects: "Manage projects within teams",
	"access-groups": "Manage access groups for role-based permissions",
	budgets: "Set and monitor spending budgets",
	"model-hub-table": "Explore available AI models and providers",
	"transform-request": "Set up request transformation rules",
	"cost-tracking": "Track and analyze API costs",
	"tag-management": "Organize resources with tags",
	"claude-code-plugins": "Configure Claude Code plugins",
	usage: "View legacy usage dashboard",
	"builtin-capabilities": "Configure vision, image generation and web search handlers",
	cliproxy: "Manage the embedded CLIProxyAPI runtime, plugins and accounts",
	"router-settings": "Configure routing and load balancing settings",
	"logging-and-alerts": "Set up logging and alert configurations",
	"admin-panel": "Access admin panel and settings",
};

export interface PageMetadata {
	page: string;
	label: string;
	group: string;
	description: string;
}
