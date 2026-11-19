import { describe, expect, it } from "vitest";
import { modelManagementSection, modelSectionFromLegacyTab, pageByModelSection } from "./ModelManagementSections";

describe("model management sections", () => {
	it("maps every sidebar page id to its section and back", () => {
		for (const [section, page] of Object.entries(pageByModelSection)) expect(modelManagementSection(page)).toBe(section);
	});

	it("falls back to All Models for an unknown page id instead of rendering nothing", () => {
		expect(modelManagementSection("models-and-endpoints")).toBe("models");
		expect(modelManagementSection("api-keys")).toBe("models");
	});

	it("translates the retired ?tab= values that old bookmarks still carry", () => {
		expect(modelSectionFromLegacyTab("add-model")).toBe("models");
		// Health Status 页面已下线，旧 tab 地址落到 All Models。
		expect(modelSectionFromLegacyTab("health")).toBe("models");
		expect(modelSectionFromLegacyTab("price-data")).toBe("prices");
		expect(modelSectionFromLegacyTab("credentials")).toBe("credentials");
		expect(modelSectionFromLegacyTab("constructor")).toBeUndefined();
		expect(modelSectionFromLegacyTab("unknown")).toBeUndefined();
	});
});
