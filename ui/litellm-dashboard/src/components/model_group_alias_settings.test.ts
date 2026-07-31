import { describe, expect, it } from "vitest";
import { resolveAliasPath } from "./model_group_alias_settings";

describe("resolveAliasPath", () => {
	it("解释任意深度 alias 并判断最终模型可达", () => {
		const resolution = resolveAliasPath(
			"advanced",
			{ advanced: "t1", t1: "gpt-5.6-sol" },
			new Set(["gpt-5.6-sol"]),
		);
		expect(resolution).toEqual({
			path: ["advanced", "t1", "gpt-5.6-sol"],
			resolvedModel: "gpt-5.6-sol",
			reachable: true,
			error: undefined,
		});
	});

	it("最终目标没有 deployment 时标记不可达", () => {
		expect(resolveAliasPath("broken", { broken: "missing" }, new Set(["available"]))).toMatchObject({
			path: ["broken", "missing"],
			reachable: false,
			error: "No deployment matches “missing”",
		});
	});

	it("识别 Router 支持的 provider 前缀与 wildcard deployment", () => {
		expect(resolveAliasPath("dynamic", { dynamic: "openai/team-model-a" }, new Set(["team-model-*"]))).toMatchObject({
			resolvedModel: "openai/team-model-a",
			reachable: true,
		});
	});

	it("编辑中的环会返回明确路径而不是死循环", () => {
		expect(resolveAliasPath("a", { a: "b", b: "a" }, new Set())).toMatchObject({
			path: ["a", "b", "a"],
			reachable: false,
			error: "Alias cycle: a → b → a",
		});
	});
});
