import type { NavigationGroup } from "../support/NavigationModels";

const admins = ["Admin", "Admin Viewer", "proxy_admin", "proxy_admin_viewer", "org_admin"];
const internal = ["Internal User", "Internal Viewer"];
const writers = ["Internal User", "Admin", "proxy_admin"];

export const navigationGroups: readonly NavigationGroup[] = [
	{
		label: "AI GATEWAY",
		items: [
			{ page: "api-keys", label: "Virtual Keys", icon: "KeyOutlined" },
			{ page: "llm-playground", label: "Playground", icon: "PlayCircleOutlined", roles: writers },
			{ page: "models", label: "Models + Endpoints", icon: "BlockOutlined", roles: writers },
			{ page: "search-tools", label: "Search Tools", icon: "SearchOutlined" },
		],
	},
	{
		label: "OBSERVABILITY",
		items: [
			{ page: "new_usage", label: "Usage", icon: "BarChartOutlined", roles: [...admins, ...internal] },
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
			{ page: "builtin-capabilities", label: "Built-in Capabilities", icon: "ToolOutlined", roles: admins },
			{ page: "router-settings", label: "Router Settings", icon: "SettingOutlined", roles: admins },
			{ page: "subscriptions", label: "Subscriptions", icon: "CrownOutlined", roles: admins },
			{ page: "logging-and-alerts", label: "Logging & Alerts", icon: "SettingOutlined", roles: admins },
			{ page: "admin-panel", label: "Admin Settings", icon: "SettingOutlined", roles: admins },
			{ page: "cost-tracking", label: "Cost Tracking", icon: "BarChartOutlined", roles: admins },
		],
	},
];

export { pathPages } from "../../../../../../src/shared/WebUiPaths";
export const migratedPathPages = new Set(["api-reference", "builtin-capabilities", "speed", "privacy"]);
