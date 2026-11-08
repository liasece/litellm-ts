import { describe, expect, it } from "vitest";
import { updateModelFallbacks } from "./ModelFallbackLogic";

describe("saving one model's fallback chain", () => {
	it("preserves peer models in a shared entry and the configured routing order", () => {
		const current = {
			num_retries: 3,
			model_group_retry_policy: { legacy: 1 },
			fallbacks: [{ before: ["first"] }, { target: ["old"], peer: ["keep"] }, { after: ["last"] }],
		};
		const original = structuredClone(current);
		expect(updateModelFallbacks(current, "target", ["new", "second"])).toEqual({
			num_retries: 3,
			fallbacks: [{ before: ["first"] }, { target: ["new", "second"], peer: ["keep"] }, { after: ["last"] }],
		});
		expect(current).toEqual(original);
	});
	it("clearing a chain removes only the chosen model and drops empty entries", () => {
		expect(
			updateModelFallbacks({ fallbacks: [{ target: ["a"], peer: ["b"] }, { target: ["c"] }, { other: ["d"] }] }, "target", []),
		).toEqual({
			fallbacks: [{ peer: ["b"] }, { other: ["d"] }],
		});
	});
	it("appends a new chain while keeping existing entries, and does not append empty chains", () => {
		const current = { fallbacks: [{ peer: ["keep"] }], timeout: 30 };
		expect(updateModelFallbacks(current, "new", ["a"])).toEqual({ fallbacks: [{ peer: ["keep"] }, { new: ["a"] }], timeout: 30 });
		expect(updateModelFallbacks(current, "new", [])).toEqual(current);
	});
	it("starts a chain when callbacks have no fallback array and snapshots the selection", () => {
		const selected = ["a"];
		const next = updateModelFallbacks({ fallbacks: null, num_retries: 2 }, "target", selected);
		selected.push("later");
		expect(next).toEqual({ fallbacks: [{ target: ["a"] }], num_retries: 2 });
	});
});
