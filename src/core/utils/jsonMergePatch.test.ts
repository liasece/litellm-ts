import { jsonMergePatch } from "./jsonMergePatch";

describe("JSON Merge Patch", () => {
	it("preserves omitted keys, removes null keys and replaces arrays without mutating source", () => {
		const before = { account: { owner: "u1", deprecated: true }, tags: ["old"] };
		expect(jsonMergePatch(before, { account: { deprecated: null, cost_center: "finance" }, tags: ["new"] })).toEqual({
			account: { owner: "u1", cost_center: "finance" },
			tags: ["new"],
		});
		expect(before.account.deprecated).toBe(true);
	});
	it("does not accept prototype-polluting keys", () => {
		jsonMergePatch({}, JSON.parse('{"__proto__":{"polluted":true}}'));
		expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
	});
});
