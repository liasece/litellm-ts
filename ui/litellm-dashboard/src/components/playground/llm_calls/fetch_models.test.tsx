import { describe, expect, it } from "vitest";
import { modelGroupsToSelectOptions } from "./fetch_models";

describe("modelGroupsToSelectOptions", () => {
	it("labels aliases and models, sorts aliases first, deduplicates, and preserves raw values", () => {
		expect(
			modelGroupsToSelectOptions([
				{ model_group: "z-model", type: "model" },
				{ model_group: "beta", type: "alias" },
				{ model_group: "a-model" },
				{ model_group: "alpha", type: "alias" },
				{ model_group: "alpha", type: "model" },
			]),
		).toEqual([
			{ value: "alpha", label: "Alias: alpha" },
			{ value: "beta", label: "Alias: beta" },
			{ value: "a-model", label: "模型: a-model" },
			{ value: "z-model", label: "模型: z-model" },
		]);
	});
});
