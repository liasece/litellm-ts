import { describe, expect, it } from "vitest";
import { buildModelResolutionLines } from "./columns";

describe("buildModelResolutionLines", () => {
	it("将请求、嵌套 alias、fallback 与最终执行模型逐跳分行", () => {
		expect(
			buildModelResolutionLines(
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
			{ label: "Request", path: ["A"] },
			{ label: "Alias", path: ["A", "alias-mid"] },
			{ label: "Alias", path: ["alias-mid", "B"] },
			{ label: "Fallback 1", path: ["B", "fallback-alias"] },
			{ label: "Alias", path: ["fallback-alias", "C"] },
			{ label: "Executed", path: ["openai/C"] },
		]);
	});
});
