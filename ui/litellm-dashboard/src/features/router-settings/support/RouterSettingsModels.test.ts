import { describe, expect, it } from "vitest";
import { fallbackEntries, fallbackEntriesWire, fallbackTargets } from "./RouterSettingsModels";

describe("fallback entry normalization", () => {
	it("reads the compact array form as recursive", () => {
		expect(fallbackTargets(["a", "b"])).toEqual({ targets: ["a", "b"], recurse: true });
		expect(fallbackEntries([{ primary: ["backup"] }])).toEqual([{ primary: { targets: ["backup"], recurse: true } }]);
	});
	it("keeps the recursion switch from the object form", () => {
		expect(fallbackEntries([{ primary: { targets: ["cheap"], recurse: false } }])).toEqual([
			{ primary: { targets: ["cheap"], recurse: false } },
		]);
	});
	it("ignores malformed entries instead of inventing targets", () => {
		expect(fallbackTargets({ recurse: false })).toEqual({ targets: [], recurse: true });
		expect(fallbackEntries(null)).toEqual([]);
	});
});

describe("fallback entry serialization", () => {
	it("writes the compact form while recursion stays enabled", () => {
		expect(fallbackEntriesWire([{ primary: { targets: ["a", "b"], recurse: true } }])).toEqual([{ primary: ["a", "b"] }]);
	});
	it("writes the object form only when recursion is disabled", () => {
		expect(fallbackEntriesWire([{ primary: { targets: ["cheap"], recurse: false } }])).toEqual([
			{ primary: { targets: ["cheap"], recurse: false } },
		]);
	});
	it("round-trips through normalize and serialize", () => {
		const wire = [{ a: ["x"] }, { b: { targets: ["y", "z"], recurse: false } }];
		expect(fallbackEntriesWire(fallbackEntries(wire))).toEqual(wire);
	});
});
