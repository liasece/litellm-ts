import { migratedPathPages, navigationGroups, pathPages } from "../data/NavigationData";
import type { NavigationAccess, NavigationGroup } from "../support/NavigationModels";

/**
 * Legacy `?page=` ids whose Vue page was retired; keep old bookmarks landing on a live page.
 */
const retiredPageRedirects: Readonly<Record<string, string>> = {
	cliproxy: "subscription-runtime",
	usage: "new_usage",
	"old-usage": "new_usage",
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
	if (migratedPathPages.has(page)) return uiBase.replace(/\/$/, "") + "/" + page;
	return uiBase.replace(/\/$/, "") + "/?" + new URLSearchParams({ page }).toString();
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
				if (!admin && access.enabledInternalPages !== null && !access.enabledInternalPages.includes(item.page)) return false;
				return true;
			}),
		}))
		.filter((group) => group.items.length > 0);
}
