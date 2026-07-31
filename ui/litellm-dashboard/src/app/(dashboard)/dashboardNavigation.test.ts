import { describe, expect, it } from "vitest";
import { buildLegacyDashboardHref, deriveDashboardPage } from "./dashboardNavigation";

const searchParams = (page?: string) => new URLSearchParams(page ? { page } : undefined);

describe("deriveDashboardPage", () => {
	it.each([
		["/teams", "teams"],
		["/models-and-endpoints", "models"],
		["/virtual-keys", "api-keys"],
		["/playground", "llm-playground"],
		["/usage", "new_usage"],
		["/model-hub", "model-hub-table"],
	])("derives the legacy navigation key from path %s", (pathname, expected) => {
		expect(deriveDashboardPage(pathname, searchParams())).toBe(expected);
	});

	it("gives a migrated path priority over a stale legacy page query", () => {
		expect(deriveDashboardPage("/teams", searchParams("api-keys"))).toBe("teams");
	});

	it("respects a configured base prefix and nested route", () => {
		expect(deriveDashboardPage("/custom/ui/teams/team-1", searchParams(), "/custom/ui/")).toBe("teams");
	});

	it("keeps legacy query-param navigation for the dashboard root", () => {
		expect(deriveDashboardPage("/ui/", searchParams("logs"), "/ui/")).toBe("logs");
	});

	it("falls back to virtual keys when neither route model has a page", () => {
		expect(deriveDashboardPage("/ui/", searchParams(), "/ui/")).toBe("api-keys");
	});
});

describe("buildLegacyDashboardHref", () => {
	it("builds a canonical page entry without carrying current page state", () => {
		expect(buildLegacyDashboardHref("logs")).toBe("?page=logs");
		expect(buildLegacyDashboardHref("models")).toBe("?page=models");
	});

	it("encodes unexpected page characters instead of producing an unsafe query", () => {
		expect(buildLegacyDashboardHref("logs&key_alias=leak")).toBe("?page=logs%26key_alias%3Dleak");
	});
});
