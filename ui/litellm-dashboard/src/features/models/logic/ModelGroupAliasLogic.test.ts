import { describe, expect, it } from "vitest";
import {
	getModelGroupAliasRecurse,
	getModelGroupAliasTarget,
	selectModelGroupAliasTargets,
	validateModelGroupAliases,
} from "./ModelGroupAliasLogic";

describe("alias target selection", () => {
	it("keeps the declared order and treats the first target as primary", () => {
		expect(selectModelGroupAliasTargets(["primary", "backup"])).toEqual({
			target: "primary",
			scheduled: false,
			targets: ["primary", "backup"],
		});
		expect(getModelGroupAliasTarget({ targets: ["a", "b"], recurse: false })).toBe("a");
	});
	it("promotes the active window target without turning the other window's model into a backup", () => {
		const value = {
			targets: ["cheap-a", "cheap-b"],
			timezone: "UTC",
			schedule: [{ start: "09:00", end: "17:00", model: "work" }],
		};
		const inside = selectModelGroupAliasTargets(value, new Date("2026-01-05T10:00:00Z"));
		expect(inside).toEqual({ target: "work", scheduled: true, targets: ["work", "cheap-a", "cheap-b"] });
		expect(selectModelGroupAliasTargets(value, new Date("2026-01-05T18:00:00Z"))).toEqual({
			target: "cheap-a",
			scheduled: false,
			targets: ["cheap-a", "cheap-b"],
		});
		const legacy = { model: "minimax", timezone: "UTC", schedule: [{ start: "00:30", end: "08:30", model: "deepseek" }] };
		expect(selectModelGroupAliasTargets(legacy, new Date("2026-01-05T02:00:00Z"))?.targets).toEqual(["deepseek"]);
	});
	it("defaults recursion to true and only honours an explicit false", () => {
		expect(getModelGroupAliasRecurse("target")).toBe(true);
		expect(getModelGroupAliasRecurse(["a", "b"])).toBe(true);
		expect(getModelGroupAliasRecurse({ targets: ["a"] })).toBe(true);
		expect(getModelGroupAliasRecurse({ targets: ["a"], recurse: false })).toBe(false);
	});
});

describe("alias validation", () => {
	it("accepts ordered targets with the recursion switch", () => {
		expect(() => validateModelGroupAliases({ cheap: { targets: ["a", "b"], recurse: false }, plain: ["c", "d"] })).not.toThrow();
	});
	it.each([
		["model and targets together", { a: { model: "b", targets: ["c"] } }, /either model or targets/],
		["empty target list", { a: { targets: [] } }, /non-empty targets/],
		["non-boolean recurse", { a: { targets: ["b"], recurse: "no" } }, /recurse must be a boolean/],
		["cycle through a secondary target", { a: { targets: ["b", "c"] }, c: "a" }, /cycle detected/],
	])("rejects %s", (_name, value, error) => {
		expect(() => validateModelGroupAliases(value)).toThrow(error);
	});
});
