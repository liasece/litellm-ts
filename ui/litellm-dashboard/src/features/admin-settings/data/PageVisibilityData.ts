import { navigationGroups } from "../../application/data/NavigationData";
const descriptions: Record<string, string> = {
	"api-keys": "Manage virtual keys for API access and authentication",
	"llm-playground": "Interactive playground for testing LLM requests",
	models: "Configure and manage LLM models and endpoints",
	"mcp-servers": "Configure Model Context Protocol servers",
	"search-tools": "Configure RAG search and retrieval tools",
	new_usage: "View usage analytics and metrics",
	logs: "Access request and response logs",
	speed: "Compare model output token speed (TPS) over time",
	teams: "Create and manage teams for access control",
	"model-hub-table": "Explore available AI models and providers",
	"transform-request": "Set up request transformation rules",
	usage: "View legacy usage dashboard",
};
export const internalPages = navigationGroups.flatMap((group) =>
	group.items
		.filter((item) => !item.roles?.length || item.roles.some((role) => ["Internal User", "Internal Viewer"].includes(role)))
		.map((item) => ({
			page: item.page,
			label: item.label,
			group: group.label,
			description: descriptions[item.page] || "No description available",
		})),
);
export const pageGroups = [...new Set(internalPages.map((page) => page.group))].map((group) => ({
	label: group,
	pages: internalPages.filter((page) => page.group === group),
}));
