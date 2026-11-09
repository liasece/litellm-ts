import { describe, expect, it } from "vitest";
import { dashboardHref, dashboardPageFromUrl, visibleNavigation } from "./NavigationLogic";

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
		expect(dashboardHref("models")).toBe("/ui/?page=models");
		expect(dashboardHref("speed")).toBe("/ui/speed");
	});

	it("applies role and configured page visibility together", () => {
		const pages = visibleNavigation({
			role: "Internal User",
			isOrganizationAdmin: false,
			enabledInternalPages: ["api-keys", "logs", "admin-panel"],
		}).flatMap((group) => group.items.map((item) => item.page));
		expect(pages).toEqual(["api-keys", "logs"]);
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
