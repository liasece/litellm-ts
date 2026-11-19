import { describe, expect, it } from "vitest";
import { dashboardHref, dashboardPageFromUrl, visibleNavigation } from "./NavigationLogic";
import { navigationGroups, pagePaths, pathPages } from "../data/NavigationData";
import { isRegisteredPage } from "../data/PageRegistry";

describe("existing dashboard URLs and access", () => {
	it("drops retired path aliases instead of routing to a missing page", () => {
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/model_hub"))).toBe("api-keys");
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/guardrails"))).toBe("api-keys");
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/tools/mcp-servers"))).toBe("api-keys");
	});

	it("keeps legacy query ids for retired pages on a live page", () => {
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/?page=usage"))).toBe("new_usage");
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/?page=old-usage"))).toBe("new_usage");
	});

	it("opens path and legacy query entries without leaking another page's filters", () => {
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/logs?request_id=r"))).toBe("logs");
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/?page=cliproxy"))).toBe("subscription-runtime");
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/subscriptions/runtime"))).toBe("subscription-runtime");
		expect(dashboardPageFromUrl(new URL("https://example.test/proxy/ui/usage"), "/proxy/ui")).toBe("new_usage");
		expect(dashboardHref("speed")).toBe("/ui/speed");
	});

	it("keeps a stable path for every section that used to be a tab", () => {
		expect(dashboardHref("models")).toBe("/ui/models");
		expect(dashboardHref("new_usage")).toBe("/ui/usage/cost");
		expect(dashboardHref("usage-endpoints")).toBe("/ui/usage/endpoints");
		// 未迁移的分区仍走旧的查询地址，避免把没验证过的页面暴露成路径。
		expect(dashboardHref("teams")).toBe("/ui/?page=teams");
	});

	it("resolves section paths and the retired path alias back to their page ids", () => {
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/models"))).toBe("models");
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/models/"))).toBe("models");
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/models/retries"))).toBe("models-retries");
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/usage/cost"))).toBe("new_usage");
		// 已下线页面的旧地址仍落在活着的页面上，不断链。
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/usage/mcp"))).toBe("new_usage");
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/models/health"))).toBe("models");
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/settings/logging-and-alerts"))).toBe("admin-panel");
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/?page=cost-tracking"))).toBe("admin-panel");
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/?page=models-health"))).toBe("models");
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/models-and-endpoints"))).toBe("models");
	});

	it("applies role and configured page visibility together", () => {
		const pages = visibleNavigation({
			role: "Internal User",
			isOrganizationAdmin: false,
			enabledInternalPages: ["api-keys", "logs", "admin-panel"],
		}).flatMap((group) => group.items.map((item) => item.page));
		expect(pages).toEqual(["api-keys", "logs"]);
	});

	it("keeps every split page visible for the configured pre-split page id", () => {
		const navigation = visibleNavigation({
			role: "Internal User",
			isOrganizationAdmin: false,
			enabledInternalPages: ["models", "new_usage"],
		});
		expect(navigation.map((group) => group.label)).toEqual(["MODEL MANAGEMENT", "USAGE"]);
		expect(navigation.flatMap((group) => group.items.map((item) => item.page))).toEqual([
			"models",
			"new_usage",
			"usage-models",
			"usage-keys",
			"usage-endpoints",
		]);
	});

	it("keeps the administrator-only sections out of the internal user sidebar", () => {
		const navigation = visibleNavigation({
			role: "Internal User",
			isOrganizationAdmin: false,
			enabledInternalPages: ["models"],
		});
		expect(navigation.map((group) => group.label)).toEqual(["MODEL MANAGEMENT"]);
		expect(navigation[0].items.map((item) => item.page)).toEqual(["models"]);
	});

	it("preserves organization administrator access to user management", () => {
		const pages = visibleNavigation({
			role: "Internal User",
			isOrganizationAdmin: true,
			enabledInternalPages: null,
		}).flatMap((group) => group.items.map((item) => item.page));
		expect(pages).toContain("users");
		expect(pages).toContain("organizations");
	});
});

describe("navigation and routing contract", () => {
	it("routes every sidebar item to a registered page that resolves back to itself", () => {
		for (const item of navigationGroups.flatMap((group) => group.items)) {
			expect(isRegisteredPage(item.page), item.page).toBe(true);
			expect(dashboardPageFromUrl(new URL(dashboardHref(item.page), "https://example.test")), item.page).toBe(item.page);
		}
	});

	it("keeps the path aliases and the page-to-path map consistent", () => {
		for (const [path, page] of Object.entries(pathPages)) expect(isRegisteredPage(page), path).toBe(true);
		for (const [page, path] of Object.entries(pagePaths)) {
			expect(pathPages[path], page).toBe(page);
			expect(dashboardHref(page), page).toBe("/ui/" + path);
		}
	});
});
