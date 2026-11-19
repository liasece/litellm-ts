/** Frontend path aliases shared by the browser router and its static HTML host. */
export const pathPages: Readonly<Record<string, string>> = {
	"api-reference": "api-reference",
	"builtin-capabilities": "builtin-capabilities",
	speed: "speed",
	privacy: "privacy",
	subscriptions: "subscriptions",
	"subscriptions/runtime": "subscription-runtime",
	logs: "logs",
	models: "models",
	"models/credentials": "models-credentials",
	// Health Status 页面已移除，旧书签落在 All Models。
	"models/health": "models",
	"models/retries": "models-retries",
	"models/aliases": "models-aliases",
	"models/prices": "models-prices",
	"models-and-endpoints": "models",
	organizations: "organizations",
	playground: "llm-playground",
	teams: "teams",
	usage: "new_usage",
	"usage/cost": "new_usage",
	"usage/models": "usage-models",
	"usage/keys": "usage-keys",
	// MCP Server Activity 页面已移除，旧书签落在 Cost。
	"usage/mcp": "new_usage",
	"usage/endpoints": "usage-endpoints",
	"usage/quota": "usage-quota",
	users: "users",
	"virtual-keys": "api-keys",
	"test-key": "test-key",
	// Logging & Alerts 页面已移除，旧书签落在 Admin Settings。
	"settings/logging-and-alerts": "admin-panel",
	"settings/ui-theme": "ui-theme",
	"settings/router-settings": "router-settings",
	"settings/admin-settings": "admin-panel",
	login: "login",
	chat: "chat",
};

/**
 * Browser path for page ids that use path routing; absent ids keep the legacy `?page=` form.
 *
 * Separate from {@link pathPages} because page ids must stay stable (`enabled_ui_pages_internal_users`
 * and old bookmarks use them) while the URL keeps the readable nested path.
 */
export const pagePaths: Readonly<Record<string, string>> = {
	"api-reference": "api-reference",
	"builtin-capabilities": "builtin-capabilities",
	speed: "speed",
	privacy: "privacy",
	models: "models",
	"models-credentials": "models/credentials",
	"models-retries": "models/retries",
	"models-aliases": "models/aliases",
	"models-prices": "models/prices",
	new_usage: "usage/cost",
	"usage-models": "usage/models",
	"usage-keys": "usage/keys",
	"usage-endpoints": "usage/endpoints",
	"usage-quota": "usage/quota",
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
