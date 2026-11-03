import { describe, expect, it } from "vitest";
import { PRETTY_FIELD_RULES, isMeaningful, readFieldPath, readFieldRule } from "./prettyFieldRules";

describe("pretty field rules", () => {
	it("把空字符串、空数组和空对象都视为没有内容", () => {
		expect(isMeaningful("")).toBe(false);
		expect(isMeaningful([])).toBe(false);
		expect(isMeaningful({})).toBe(false);
		expect(isMeaningful(null)).toBe(false);
		expect(isMeaningful(undefined)).toBe(false);
		expect(isMeaningful("text")).toBe(true);
		expect(isMeaningful([{ text: "x" }])).toBe(true);
		expect(isMeaningful({ text: "x" })).toBe(true);
		expect(isMeaningful(0)).toBe(true);
		expect(isMeaningful(false)).toBe(true);
	});

	it("按 a.b 路径读取嵌套字段，遇到非对象立即返回 undefined", () => {
		const block = { image_url: { url: "https://example.com/a.png" }, name: "tool" };

		expect(readFieldPath(block, "image_url.url")).toBe("https://example.com/a.png");
		expect(readFieldPath(block, "name")).toBe("tool");
		expect(readFieldPath(block, "name.length")).toBeUndefined();
		expect(readFieldPath(block, "missing.deep")).toBeUndefined();
	});

	it("空容器不会挡住后面真正有内容的候选字段", () => {
		// 生产实测形状：reasoning item 带 summary: []，正文在 content 里。
		const block = { summary: [], content: [{ text: "真正的推理" }] };

		expect(readFieldRule(block, PRETTY_FIELD_RULES.reasoning)).toEqual([{ text: "真正的推理" }]);
	});

	it("有摘要时优先返回摘要，符合客户端可见语义", () => {
		const block = { summary: [{ text: "摘要" }], content: [{ text: "完整正文" }] };

		expect(readFieldRule(block, PRETTY_FIELD_RULES.reasoning)).toEqual([{ text: "摘要" }]);
	});

	it("全部候选都为空时返回 fallback", () => {
		expect(readFieldRule({}, PRETTY_FIELD_RULES.toolCallId)).toBe("");
		expect(readFieldRule({ filename: "" }, PRETTY_FIELD_RULES.documentLabel)).toBe("Attached document");
		expect(readFieldRule({ content: [] }, PRETTY_FIELD_RULES.toolResult)).toBeUndefined();
	});

	it("工具调用参数兼容 input、arguments 与嵌套 function.arguments", () => {
		expect(readFieldRule({ input: "git status" }, PRETTY_FIELD_RULES.toolArguments)).toBe("git status");
		expect(readFieldRule({ arguments: '{"a":1}' }, PRETTY_FIELD_RULES.toolArguments)).toBe('{"a":1}');
		expect(readFieldRule({ function: { arguments: "{}" } }, PRETTY_FIELD_RULES.toolArguments)).toBe("{}");
	});

	it("图片规则能从嵌套 source 与扁平字段两处取到来源和类型", () => {
		expect(
			readFieldRule({ source: { data: "abc", media_type: "image/webp" } }, PRETTY_FIELD_RULES.imageSource),
		).toBe("abc");
		expect(
			readFieldRule({ source: { data: "abc", media_type: "image/webp" } }, PRETTY_FIELD_RULES.imageMimeType),
		).toBe("image/webp");
		expect(readFieldRule({ mimeType: "image/png" }, PRETTY_FIELD_RULES.imageMimeType)).toBe("image/png");
	});

	it("把只有空白字符的字符串也视为没有内容", () => {
		// 生产实测：reasoning 文本可能只是一个空格（reasoning_tokens 为 1），页面上什么都看不到。
		expect(isMeaningful(" ")).toBe(false);
		expect(isMeaningful("\n\t ")).toBe(false);
		expect(readFieldRule({ content: " " }, PRETTY_FIELD_RULES.reasoning)).toBeUndefined();
	});
});
