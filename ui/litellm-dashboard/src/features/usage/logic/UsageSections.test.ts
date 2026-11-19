import { describe, expect, it } from "vitest";
import { pageByUsageSection, usageSection } from "./UsageSections";

describe("usage sections", () => {
	it("maps every sidebar page id to its section and back", () => {
		for (const [section, page] of Object.entries(pageByUsageSection)) expect(usageSection(page)).toBe(section);
	});

	it("landed old usage links on Cost", () => {
		expect(usageSection("usage")).toBe("cost");
		expect(usageSection("unknown-page")).toBe("cost");
	});
});
