import { describe, expect, it } from "vitest";
import { filterMarketplace, installCommand, marketplaceCategories } from "./ModelHubMarketplaceLogic";
import type { HubPlugin } from "../support/ModelHubModels";
describe("Hub marketplace", () => {
	it("combines category and name/description/keyword search and keeps the original CLI source command", () => {
		const plugins: HubPlugin[] = [
			{ name: "repo-plugin", source: { source: "github", repo: "company/plugin" }, category: "Development", keywords: ["testing"] },
			{ name: "url-plugin", source: { source: "url", url: "https://example.test/marketplace.json" }, description: "Testing helpers" },
		];
		expect(marketplaceCategories(plugins)).toEqual(["All", "Development", "Other"]);
		expect(filterMarketplace(plugins, " testing ", "Development")).toEqual([plugins[0]]);
		expect(filterMarketplace(plugins, "testing", "Other")).toEqual([plugins[1]]);
		expect(installCommand(plugins[0])).toBe("/plugin marketplace add company/plugin");
		expect(installCommand(plugins[1])).toBe("/plugin marketplace add https://example.test/marketplace.json");
	});
});
