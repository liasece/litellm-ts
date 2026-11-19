import { navigationGroups, pageAccessAlias, pagePaths, pathPages } from "../data/NavigationData";
import type { NavigationAccess, NavigationGroup } from "../support/NavigationModels";

/**
 * Legacy `?page=` ids whose Vue page was retired; keep old bookmarks landing on a live page.
 */
const retiredPageRedirects: Readonly<Record<string, string>> = {
	cliproxy: "subscription-runtime",
	usage: "new_usage",
	"old-usage": "new_usage",
	// 2026-11-19 下线的页面：留一条落点，旧链接不会停在空白页。
	"models-health": "models",
	"usage-mcp": "new_usage",
	"logging-and-alerts": "admin-panel",
	"cost-tracking": "admin-panel",
};

export function dashboardPageFromUrl(url: URL, uiBase = "/ui"): string {
	const base = "/" + uiBase.replace(/^\/+|\/+$/g, "");
	const relative =
		url.pathname === base
			? ""
			: url.pathname.startsWith(base + "/")
				? url.pathname.slice(base.length + 1).replace(/\/+$/, "")
				: url.pathname.replace(/^\/+|\/+$/g, "");
	const page = pathPages[relative] ?? url.searchParams.get("page") ?? "api-keys";
	return retiredPageRedirects[page] ?? page;
}

export function dashboardHref(page: string, uiBase = "/ui"): string {
	const base = uiBase.replace(/\/$/, "");
	const path = pagePaths[page];
	if (path) return base + "/" + path;
	return base + "/?" + new URLSearchParams({ page }).toString();
}

export function visibleNavigation(access: NavigationAccess): NavigationGroup[] {
	const adminRoles = ["Admin", "Admin Viewer", "proxy_admin", "proxy_admin_viewer", "org_admin"];
	const admin = adminRoles.includes(access.role);
	return navigationGroups
		.filter((group) => !group.roles || group.roles.includes(access.role))
		.map((group) => ({
			...group,
			items: group.items.filter((item) => {
				const organizationAccess = ["users", "organizations"].includes(item.page) && access.isOrganizationAdmin;
				if (item.roles && !item.roles.includes(access.role) && !organizationAccess) return false;
				// 拆分出来的页面沿用原页面 id 判断内部用户可见性，老配置不必改。
				const alias = pageAccessAlias(item.page);
				const configuredPages = access.enabledInternalPages;
				if (
					!admin &&
					configuredPages !== null &&
					!configuredPages.includes(item.page) &&
					!(alias && configuredPages.includes(alias))
				)
					return false;
				return true;
			}),
		}))
		.filter((group) => group.items.length > 0);
}
