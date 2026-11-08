import { describe, expect, it } from "vitest";
import { dashboardHref, dashboardPageFromUrl, visibleNavigation } from "./NavigationLogic";

describe("existing dashboard URLs and access", () => {
	it("keeps anonymous model catalog paths distinct from the private AI Hub query and path", () => {
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/model_hub_table"))).toBe("public-model-hub");
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/model_hub"))).toBe("public-model-hub");
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/model-hub"))).toBe("model-hub-table");
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/?page=model-hub-table"))).toBe("model-hub-table");
		expect(dashboardPageFromUrl(new URL("https://example.test/proxy/ui/model_hub_table"), "/proxy/ui")).toBe("public-model-hub");
	});

	it("opens path and legacy query entries without leaking another page's filters", () => {
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/logs?request_id=r"))).toBe("logs");
		expect(dashboardPageFromUrl(new URL("https://example.test/ui/?page=cliproxy"))).toBe("cliproxy");
		expect(dashboardPageFromUrl(new URL("https://example.test/proxy/ui/usage"), "/proxy/ui")).toBe("new_usage");
		expect(dashboardHref("models")).toBe("/ui/?page=models");
		expect(dashboardHref("speed")).toBe("/ui/speed");
	});
	it("applies role and configured page visibility together", () => {
		const pages = visibleNavigation({
			role: "Internal User",
			isOrganizationAdmin: false,
			projectsEnabled: true,
			enabledInternalPages: ["api-keys", "logs", "admin-panel"],
		}).flatMap((group) => group.items.map((item) => item.page));
		expect(pages).toEqual(["api-keys", "logs"]);
	});
	it("preserves organization administrator access to user management", () => {
		const pages = visibleNavigation({
			role: "Internal User",
			isOrganizationAdmin: true,
			projectsEnabled: false,
			enabledInternalPages: null,
		}).flatMap((group) => group.items.map((item) => item.page));
		expect(pages).toContain("users");
		expect(pages).toContain("organizations");
		expect(pages).not.toContain("projects");
	});
});
