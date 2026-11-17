import { validateFallbackEntries, normalizeFallbackEntry } from "./FallbackEntry";

describe("fallback 条目契约", () => {
	it("数组形态归一化为默认允许递归", () => {
		expect(normalizeFallbackEntry(["a", "b"])).toEqual({ targets: ["a", "b"], recurse: true });
	});

	it("对象形态保留 recurse:false", () => {
		expect(normalizeFallbackEntry({ targets: ["a"], recurse: false })).toEqual({ targets: ["a"], recurse: false });
	});

	it("无法解释的值归一化为空目标（运行期跳过该条目）", () => {
		expect(normalizeFallbackEntry("a")).toEqual({ targets: [], recurse: true });
		expect(normalizeFallbackEntry({ model: "a" })).toEqual({ targets: [], recurse: true });
	});

	it("接受 List[Dict] 与 Record 两种顶层形态", () => {
		expect(() => validateFallbackEntries([{ a: ["b"] }, { c: { targets: ["d"], recurse: false } }])).not.toThrow();
		expect(() => validateFallbackEntries({ a: ["b"] })).not.toThrow();
	});

	it.each([
		["空目标列表", { a: [] }, /at least one fallback model/],
		["非字符串目标", { a: [1] }, /non-empty model names/],
		["recurse 非布尔", { a: { targets: ["b"], recurse: "no" } }, /recurse must be a boolean/],
		["缺少 targets", { a: { recurse: false } }, /requires a targets list/],
		["非对象条目", { a: 42 }, /model list or a \{ targets, recurse \} object/],
	])("拒绝%s", (_name, value, error) => {
		expect(() => validateFallbackEntries(value)).toThrow(error);
	});
});
