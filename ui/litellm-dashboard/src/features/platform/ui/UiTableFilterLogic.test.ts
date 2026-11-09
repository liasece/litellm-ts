import { describe, expect, it } from "vitest";
import { filterRowsByFields, matchesTableFilter } from "./UiTableFilterLogic";
import type { UiTableActiveFilter } from "./UiTableFilterModels";

function filter(key: string, value: string, match: "fuzzy" | "exact" = "fuzzy"): UiTableActiveFilter {
	return { key, label: key, value, text: value, match };
}

describe("table header filters", () => {
	it("matches text case-insensitively and treats blank values as inactive", () => {
		expect(matchesTableFilter("GPT-4o", filter("model", "gpt"))).toBe(true);
		expect(matchesTableFilter("GPT-4o", filter("model", "gpt", "exact"))).toBe(false);
		expect(matchesTableFilter("gpt-4o", filter("model", "GPT-4O", "exact"))).toBe(true);
		expect(matchesTableFilter("anything", filter("model", "   "))).toBe(true);
	});

	it("normalizes arrays and nested objects for display-oriented filtering", () => {
		expect(matchesTableFilter(["openai", "azure"], filter("provider", "azure"))).toBe(true);
		expect(matchesTableFilter({ region: "us-east" }, filter("metadata", "us-east"))).toBe(true);
		expect(matchesTableFilter(null, filter("metadata", "us-east"))).toBe(false);
	});

	it("combines column filters with AND and reads values through the caller callback", () => {
		const rows = [
			{ id: "a", team: { alias: "Alpha" }, spend: 10 },
			{ id: "b", team: { alias: "Beta" }, spend: 20 },
			{ id: "c", team: { alias: "Alpine" }, spend: 30 },
		];
		const filters = [filter("team", "alp"), filter("spend", "30")];
		const result = filterRowsByFields(rows, filters, (row, key) => (key === "team" ? row.team.alias : row[key as "id" | "spend"]));
		expect(result.map((row) => row.id)).toEqual(["c"]);
	});

	it("returns the original rows when every filter is blank", () => {
		const rows = [{ id: "a" }, { id: "b" }];
		expect(filterRowsByFields(rows, [filter("id", " ")], (row) => row.id)).toBe(rows);
	});
});
