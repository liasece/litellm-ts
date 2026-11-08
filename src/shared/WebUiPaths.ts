/** Frontend path aliases shared by the browser router and its static HTML host. */
export const pathPages: Readonly<Record<string, string>> = {
	"api-reference": "api-reference",
	"builtin-capabilities": "builtin-capabilities",
	speed: "speed",
	guardrails: "guardrails",
	logs: "logs",
	"model-hub": "model-hub-table",
	"models-and-endpoints": "models",
	organizations: "organizations",
	playground: "llm-playground",
	policies: "policies",
	teams: "teams",
	usage: "new_usage",
	users: "users",
	"virtual-keys": "api-keys",
	"test-key": "test-key",
	"settings/logging-and-alerts": "logging-and-alerts",
	"settings/ui-theme": "ui-theme",
	"settings/router-settings": "router-settings",
	"settings/admin-settings": "admin-panel",
	"tools/mcp-servers": "mcp-servers",
	"tools/vector-stores": "vector-stores",
	"experimental/tag-management": "tag-management",
	"experimental/api-playground": "transform-request",
	"experimental/claude-code-plugins": "claude-code-plugins",
	"experimental/caching": "caching",
	"experimental/budgets": "budgets",
	"experimental/prompts": "prompts",
	"experimental/old-usage": "usage",
	model_hub_table: "public-model-hub",
	login: "login",
	onboarding: "onboarding",
	model_hub: "public-model-hub",
	chat: "chat",
	"mcp/oauth/callback": "mcp-oauth-callback",
};

/**
 * Check whether a normalized relative path is a registered browser page.
 * @param pathname - Path below the /ui mount, without leading or trailing slashes.
 * @returns Whether the browser router recognizes the page.
 */
export function isKnownWebUiPagePath(pathname: string): boolean {
	return pathname === "" || pathname === "index.html" || Object.prototype.hasOwnProperty.call(pathPages, pathname);
}

/**
 * Include route directories because relative bootstrap URLs resolve against the parent directory of an unslashed route.
 * @param pathname - Normalized directory below the /ui mount.
 * @returns Whether the directory is a known page or a parent of one.
 */
export function isKnownWebUiPathPrefix(pathname: string): boolean {
	return pathname === "" || Object.keys(pathPages).some((page) => page === pathname || page.startsWith(pathname + "/"));
}
