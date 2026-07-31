import { describe, expect, it } from "vitest";
import { buildModelResolutionTooltipLines } from "./columns";

describe("buildModelResolutionTooltipLines", () => {
	it("将请求、嵌套 alias、fallback 与最终执行模型逐跳分行", () => {
		expect(
			buildModelResolutionTooltipLines(
				["A", "fallback-alias"],
				[
					{
						fallback_index: 0,
						input_model: "A",
						resolved_model: "B",
						resolution_path: ["A", "alias-mid", "B"],
					},
					{
						fallback_index: 1,
						input_model: "fallback-alias",
						resolved_model: "C",
						resolution_path: ["fallback-alias", "C"],
					},
				],
				"openai/C",
			),
		).toEqual([
			"Request · A",
			"Alias · A → alias-mid",
			"Alias · alias-mid → B",
			"Fallback 1 · B → fallback-alias",
			"Alias · fallback-alias → C",
			"Executed · openai/C",
		]);
	});
});
