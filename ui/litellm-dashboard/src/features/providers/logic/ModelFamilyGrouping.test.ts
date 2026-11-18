import { describe, expect, it } from "vitest";
import { groupByModelFamily, unknownFamilyKey, type ModelFamilyGroup } from "./ModelFamilyGrouping";
import type { ModelFamily } from "../../../../../../src/shared/ModelFamily";

interface Row {
	name: string;
	family?: ModelFamily;
}

function names(groups: ModelFamilyGroup<Row>[]): string[][] {
	return groups.map((group) => group.items.map((item) => item.name));
}

describe("model family grouping", () => {
	it("keeps items of one brand adjacent and puts unrecognized rows first", () => {
		const rows: Row[] = [
			{ name: "gpt-5", family: "OpenAI" },
			{ name: "cheap" },
			{ name: "claude-opus", family: "Claude" },
			{ name: "gpt-6", family: "OpenAI" },
			{ name: "k3" },
			{ name: "deepseek-v4", family: "DeepSeek" },
		];
		const groups = groupByModelFamily(rows, (row) => row.family);
		expect(groups.map((group) => group.key)).toEqual([unknownFamilyKey, "Claude", "DeepSeek", "OpenAI"]);
		expect(names(groups)).toEqual([["cheap", "k3"], ["claude-opus"], ["deepseek-v4"], ["gpt-5", "gpt-6"]]);
	});

	it("preserves the incoming order inside a group so the active sort still applies per brand", () => {
		const rows: Row[] = [
			{ name: "claude-sonnet", family: "Claude" },
			{ name: "gpt-5", family: "OpenAI" },
			{ name: "claude-haiku", family: "Claude" },
		];
		expect(names(groupByModelFamily(rows, (row) => row.family))).toEqual([["claude-sonnet", "claude-haiku"], ["gpt-5"]]);
	});

	it("returns no groups for an empty list and a single unknown group when nothing is recognized", () => {
		expect(groupByModelFamily([], (row: Row) => row.family)).toEqual([]);
		const onlyUnknown = groupByModelFamily<Row>([{ name: "cheap" }, { name: "k3" }], (row) => row.family);
		expect(onlyUnknown).toHaveLength(1);
		expect(onlyUnknown[0].family).toBeNull();
	});
});
