/**
 * FallbackHandler 测试
 *
 * 对齐 Python litellm/router_utils/fallback_event_handlers.py + test_fallback_event_handlers.py
 *
 * 覆盖：
 *  - first-match-wins 合并 (PY: List[Dict] 顺序遍历)
 *  - CW/CP fallback 链独立性
 *  - alias 多值数组 (string[])
 *  - provider 前缀剥离大小写敏感比较
 *  - wildcard '*' 兜底匹配
 *  - 嵌套 alias 解析
 *  - chain cache 失效与重建
 */
import { FallbackHandler } from "./FallbackHandler";

describe("FallbackHandler", () => {
	describe("getNextFallback - 基础匹配", () => {
		it("直接 fallback 命中", () => {
			const fh = new FallbackHandler({ "gpt-4": ["claude-3"] });
			expect(fh.getNextFallback("gpt-4", 0)).toBe("claude-3");
		});

		it("没有 fallback 返回 null", () => {
			const fh = new FallbackHandler({ "gpt-4": ["claude-3"] });
			expect(fh.getNextFallback("gpt-5", 0)).toBeNull();
		});

		it("depth 超出 chain 返回 null", () => {
			const fh = new FallbackHandler({ "gpt-4": ["claude-3"] });
			expect(fh.getNextFallback("gpt-4", 0)).toBe("claude-3");
			expect(fh.getNextFallback("gpt-4", 1)).toBeNull();
		});

		it("DIFF-RT-02: wildcard '*' 命中", () => {
			const fh = new FallbackHandler({ "*": ["claude-3"] });
			expect(fh.getNextFallback("unknown-model", 0)).toBe("claude-3");
		});
	});

	describe("first-match-wins 合并 (PY List[Dict])", () => {
		it("多条记录同 key 时只保留首次", () => {
			const fh = new FallbackHandler([{ "gpt-4": ["a"] }, { "gpt-4": ["b", "c"] }]);
			expect(fh.getNextFallback("gpt-4", 0)).toBe("a");
			expect(fh.getNextFallback("gpt-4", 1)).toBeNull();
		});

		it("不同 key 按顺序追加", () => {
			const fh = new FallbackHandler([{ "gpt-4": ["a"] }, { "claude-3": ["b"] }]);
			expect(fh.getNextFallback("gpt-4", 0)).toBe("a");
			expect(fh.getNextFallback("claude-3", 0)).toBe("b");
		});

		it("传 Record<string,string[]> 形式也能工作", () => {
			const fh = new FallbackHandler({ "gpt-4": ["x"], "claude-3": ["y"] });
			expect(fh.getNextFallback("gpt-4", 0)).toBe("x");
			expect(fh.getNextFallback("claude-3", 0)).toBe("y");
		});

		it("空 fallbacks 列表返回 null", () => {
			const fh = new FallbackHandler([]);
			expect(fh.getNextFallback("any", 0)).toBeNull();
		});
	});

	describe("DIFF-RT-02: alias 解析", () => {
		it("alias 命中后解析为底层 model", () => {
			const fh = new FallbackHandler({ "gpt-4o-mini": ["gpt-4o"] }, { "gpt-4o-mini": "gpt-4o" });
			expect(fh.getNextFallback("gpt-4o-mini", 0)).toBe("gpt-4o");
		});

		it("fallback 列表中包含 alias 时通过 resolveModelGroup 解析", () => {
			const fh = new FallbackHandler({ "gpt-4o-mini": ["alias-x"] }, { "alias-x": "gpt-4o" });
			expect(fh.getNextFallback("gpt-4o-mini", 0)).toBe("gpt-4o");
		});

		it("fallbacks=[{gpt-4o-mini:[alias-x]}] 双层结构 alias 解析", () => {
			const fh = new FallbackHandler([{ "gpt-4o-mini": ["alias-x"] }], { "alias-x": "gpt-4o" });
			expect(fh.getNextFallback("gpt-4o-mini", 0)).toBe("gpt-4o");
		});

		it("fallbacks=[{*:['gpt-4o']}] + request=alias 'gpt-4o-mini' 解析后走到 'gpt-4o'", () => {
			const fh = new FallbackHandler([{ "*": ["gpt-4o"] }], { "gpt-4o-mini": "gpt-4o" });
			expect(fh.getNextFallback("gpt-4o-mini", 0)).toBe("gpt-4o");
		});
	});

	describe("DIFF-RT-ALIAS-01: alias 多值数组 (string[])", () => {
		it("alias 是 string[] 时 resolveModelGroup 返回 list[0]", () => {
			const fh = new FallbackHandler({ "gpt-4o-mini": ["gpt-4o"] }, { "gpt-4o-mini": ["gpt-4-turbo", "gpt-4o"] });
			// PY 行为：string[] 多值别名解析时取 list[0]
			expect(fh.resolveModelGroup("gpt-4o-mini")).toBe("gpt-4-turbo");
		});

		it("alias string[] 链式：fallback map 按 list[0] 命中", () => {
			const fh = new FallbackHandler({ "gpt-4-turbo": ["claude-3"] }, { "gpt-4o-mini": ["gpt-4-turbo", "gpt-4o"] });
			// list[0] = "gpt-4-turbo"，fallback 命中 "claude-3"
			expect(fh.resolveModelGroup("gpt-4o-mini")).toBe("gpt-4-turbo");
			expect(fh.getNextFallback("gpt-4o-mini", 0)).toBe("claude-3");
		});
	});

	describe("provider 前缀剥离（大小写敏感）", () => {
		it("已知 provider 前缀剥离匹配", () => {
			const fh = new FallbackHandler({ "gpt-4": ["claude-3"] });
			expect(fh.getNextFallback("openai/gpt-4", 0)).toBe("claude-3");
		});

		it("未知前缀不剥离（避免误判）", () => {
			const fh = new FallbackHandler({ "foo/gpt-4": ["claude-3"] });
			// 已知 "foo" 不在 provider 列表中，按字面查 — 命中 "foo/gpt-4" 字面 key
			expect(fh.getNextFallback("foo/gpt-4", 0)).toBe("claude-3");
		});

		it("大小写敏感比较（PY 行为）", () => {
			const fh = new FallbackHandler({ "gpt-4": ["claude-3"] });
			// "OpenAI" 大写不在小写枚举里（case-sensitive），不剥离 → 字面查
			expect(fh.getNextFallback("OpenAI/gpt-4", 0)).toBeNull();
		});
	});

	describe("CW / CP fallback 链独立性", () => {
		it("context_window_fallbacks 独立检索", () => {
			const fh = new FallbackHandler({}, {}, { "gpt-4": ["claude-cw-fallback"] }, { "gpt-4": ["claude-cp-fallback"] });
			expect(fh.getContextWindowFallbackChain("gpt-4")).toEqual(["claude-cw-fallback"]);
			expect(fh.getContentPolicyFallbackChain("gpt-4")).toEqual(["claude-cp-fallback"]);
		});

		it("CW/CP 链与普通 fallback 互不干扰", () => {
			const fh = new FallbackHandler({ "gpt-4": ["claude-general"] }, {}, { "gpt-4": ["claude-cw"] }, {});
			expect(fh.getNextFallback("gpt-4", 0)).toBe("claude-general");
			expect(fh.getContextWindowFallbackChain("gpt-4")).toEqual(["claude-cw"]);
		});
	});

	describe("alias 级联解析与配置校验", () => {
		it("任意深度 alias 解析为最终模型组", () => {
			const fh = new FallbackHandler({}, { A: "B", B: "C" });
			expect(fh.resolveModelGroup("A")).toBe("C");
		});

		it("最终 alias key 命中 fallback map", () => {
			const fh = new FallbackHandler({ C: ["fallback-model"] }, { A: "B", B: "C" });
			expect(fh.getNextFallback("A", 0)).toBe("fallback-model");
		});

		it("fallback 链中的 alias 归一为最终模型组", () => {
			const fh = new FallbackHandler({ source: ["A"] }, { A: "B", B: "C" });
			expect(fh.getFallbackChain("source")).toEqual(["C"]);
		});

		it("string[] 首项和对象 model 都继续级联", () => {
			const fh = new FallbackHandler({}, { A: ["B", "ignored"], B: { model: "C" } });
			expect(fh.resolveModelGroup("A")).toBe("C");
		});

		it.each([
			["自环", { A: "A" }, "A -> A"],
			["多节点环", { A: "B", B: "A" }, "A -> B -> A"],
		])("构造阶段拒绝%s", (_name, aliases, cycle) => {
			expect(() => new FallbackHandler({}, aliases)).toThrow(`Model group alias cycle detected: ${cycle}`);
		});

		it("运行时环配置失败后保留旧 alias 和缓存", () => {
			const fh = new FallbackHandler({ A: ["fallback-model"] }, { A: "B" });
			expect(fh.getFallbackChain("A")).toEqual(["fallback-model"]);

			expect(() => fh.setModelGroupAlias({ A: "B", B: "A" })).toThrow("Model group alias cycle detected: A -> B -> A");

			expect(fh.resolveModelGroup("A")).toBe("B");
			expect(fh.getFallbackChain("A")).toEqual(["fallback-model"]);
		});
	});

	describe("resolveModelGroupWithTrace", () => {
		it("返回嵌套 alias 的完整路径", () => {
			const fh = new FallbackHandler({}, { A: "B", B: { model: "C" } });
			expect(fh.resolveModelGroupWithTrace("A")).toEqual({
				inputModel: "A",
				resolvedModel: "C",
				resolutionPath: ["A", "B", "C"],
			});
		});

		it("fallback trace 保留配置中的 alias 输入", () => {
			const fh = new FallbackHandler({ source: ["fallback-alias"] }, { "fallback-alias": "fallback-model" });
			expect(fh.getFallbackChainWithTrace("source")).toEqual([
				{
					inputModel: "fallback-alias",
					resolvedModel: "fallback-model",
					resolutionPath: ["fallback-alias", "fallback-model"],
				},
			]);
			expect(fh.getFallbackChain("source")).toEqual(["fallback-model"]);
		});
	});

	describe("resolveModelGroup", () => {
		it("无 alias 时原样返回", () => {
			const fh = new FallbackHandler({}, {});
			expect(fh.resolveModelGroup("gpt-4o")).toBe("gpt-4o");
		});

		it("有 alias 时返回底层 model", () => {
			const fh = new FallbackHandler({}, { "gpt-4o-mini": "gpt-4o" });
			expect(fh.resolveModelGroup("gpt-4o-mini")).toBe("gpt-4o");
		});

		it("alias 是 object { model, hidden } 时返回 .model", () => {
			const fh = new FallbackHandler({}, { "gpt-4o-mini": { model: "gpt-4o", hidden: false } });
			expect(fh.resolveModelGroup("gpt-4o-mini")).toBe("gpt-4o");
		});

		it("alias 是空 string[] 时返回原 model", () => {
			const fh = new FallbackHandler({}, { "gpt-4o-mini": [] });
			expect(fh.resolveModelGroup("gpt-4o-mini")).toBe("gpt-4o-mini");
		});
	});

	describe("hasMoreFallbacks + getNextFallback 组合", () => {
		it("逐层推进返回每个 fallback", () => {
			const fh = new FallbackHandler({ "gpt-4": ["claude-3", "gemini-pro", "mistral"] });
			expect(fh.hasMoreFallbacks("gpt-4", 0)).toBe(true);
			expect(fh.getNextFallback("gpt-4", 0)).toBe("claude-3");
			expect(fh.hasMoreFallbacks("gpt-4", 1)).toBe(true);
			expect(fh.getNextFallback("gpt-4", 1)).toBe("gemini-pro");
			expect(fh.hasMoreFallbacks("gpt-4", 2)).toBe(true);
			expect(fh.getNextFallback("gpt-4", 2)).toBe("mistral");
			expect(fh.hasMoreFallbacks("gpt-4", 3)).toBe(false);
			expect(fh.getNextFallback("gpt-4", 3)).toBeNull();
		});
	});

	describe("chain cache + invalidateCache", () => {
		it("invalidateCache 后重新计算", () => {
			const fh = new FallbackHandler({ "gpt-4": ["claude-3"] });
			expect(fh.getNextFallback("gpt-4", 0)).toBe("claude-3");
			fh.invalidateCache();
			expect(fh.getNextFallback("gpt-4", 0)).toBe("claude-3");
		});
	});
});
