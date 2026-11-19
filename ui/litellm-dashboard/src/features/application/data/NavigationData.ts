import type { NavigationGroup } from "../support/NavigationModels";

const admins = ["Admin", "Admin Viewer", "proxy_admin", "proxy_admin_viewer", "org_admin"];
const internal = ["Internal User", "Internal Viewer"];
const writers = ["Internal User", "Admin", "proxy_admin"];
const modelAdmins = ["Admin", "proxy_admin", "proxy_admin_viewer", "org_admin"];

/**
 * 侧边栏分区。模型管理与用量统计各自成组：组内每一项都是一个独立页面，
 * 不再是页面内的标签页，所以新增一项等于新增一条路由，见 WebUiPaths 的 pagePaths。
 */
export const navigationGroups: readonly NavigationGroup[] = [
	{
		label: "AI GATEWAY",
		items: [
			{ page: "api-keys", label: "Virtual Keys", icon: "KeyOutlined" },
			{ page: "llm-playground", label: "Playground", icon: "PlayCircleOutlined", roles: writers },
			{ page: "search-tools", label: "Search Tools", icon: "SearchOutlined" },
		],
	},
	{
		label: "MODEL MANAGEMENT",
		items: [
			{ page: "models", label: "All Models", icon: "BlockOutlined", roles: writers },
			{ page: "models-credentials", label: "LLM Credentials", icon: "KeyOutlined", roles: modelAdmins },
			{ page: "models-retries", label: "Model Retry Settings", icon: "SyncOutlined", roles: modelAdmins },
			{ page: "models-aliases", label: "Model Group Alias", icon: "SwapOutlined", roles: modelAdmins },
			{ page: "models-prices", label: "Price Data Reload", icon: "DollarOutlined", roles: modelAdmins },
		],
	},
	{
		label: "USAGE",
		items: [
			{ page: "new_usage", label: "Cost", icon: "BarChartOutlined", roles: [...admins, ...internal] },
			{ page: "usage-models", label: "Model Activity", icon: "AppstoreOutlined", roles: [...admins, ...internal] },
			{ page: "usage-keys", label: "Key Activity", icon: "KeyOutlined", roles: [...admins, ...internal] },
			{ page: "usage-endpoints", label: "Endpoint Activity", icon: "LinkOutlined", roles: [...admins, ...internal] },
			{ page: "usage-quota", label: "Upstream Account Quota", icon: "CloudServerOutlined", roles: admins },
		],
	},
	{
		label: "OBSERVABILITY",
		items: [
			{ page: "logs", label: "Logs", icon: "LineChartOutlined" },
			{ page: "speed", label: "Speed", icon: "ThunderboltOutlined", roles: [...admins, ...internal] },
			{ page: "privacy", label: "Privacy", icon: "SafetyCertificateOutlined", roles: admins },
		],
	},
	{
		label: "ACCESS CONTROL",
		collapsible: true,
		items: [
			{ page: "teams", label: "Teams", icon: "TeamOutlined" },
			{ page: "users", label: "Internal Users", icon: "UserOutlined", roles: admins },
			{ page: "organizations", label: "Organizations", icon: "BankOutlined", roles: admins },
		],
	},
	{
		label: "SETTINGS",
		roles: admins,
		items: [
			{ page: "subscriptions", label: "Subscriptions", icon: "CrownOutlined", roles: admins },
			{ page: "builtin-capabilities", label: "Built-in Capabilities", icon: "ToolOutlined", roles: admins },
			{ page: "router-settings", label: "Router Settings", icon: "SettingOutlined", roles: admins },
			{ page: "admin-panel", label: "Admin Settings", icon: "SettingOutlined", roles: admins },
		],
	},
];

/**
 * 拆分标签页时沿用旧的页面 id 作为准入别名。
 * `enabled_ui_pages_internal_users` 里存的是拆分前的 id（`models`、`new_usage`），
 * 不认别名会让老配置把新页面全部隐藏。
 */
const pageAccessAliases: Readonly<Record<string, string>> = {
	"models-credentials": "models",
	"models-retries": "models",
	"models-aliases": "models",
	"models-prices": "models",
	"usage-models": "new_usage",
	"usage-keys": "new_usage",
	"usage-endpoints": "new_usage",
};

export function pageAccessAlias(page: string): string | undefined {
	return pageAccessAliases[page];
}

export { pathPages, pagePaths } from "../../../../../../src/shared/WebUiPaths";
