import { CONTENT_FIELD_RULES, collectTextSegments, isMeaningful, readFieldPath, readFieldRule } from "./contentFields";

describe("content field rules", () => {
	it("把空字符串、空数组和空对象都视为没有内容", () => {
		expect(isMeaningful("")).toBe(false);
		expect(isMeaningful([])).toBe(false);
		expect(isMeaningful({})).toBe(false);
		expect(isMeaningful(null)).toBe(false);
		expect(isMeaningful(undefined)).toBe(false);
		expect(isMeaningful("text")).toBe(true);
		expect(isMeaningful([{ text: "x" }])).toBe(true);
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

		expect(readFieldRule(block, CONTENT_FIELD_RULES.reasoning)).toEqual([{ text: "真正的推理" }]);
	});

	it("有摘要时优先返回摘要，符合客户端可见语义", () => {
		const block = { summary: [{ text: "摘要" }], content: [{ text: "完整正文" }] };

		expect(readFieldRule(block, CONTENT_FIELD_RULES.reasoning)).toEqual([{ text: "摘要" }]);
	});

	it("全部候选都为空时返回 fallback", () => {
		expect(readFieldRule({}, CONTENT_FIELD_RULES.toolCallId)).toBe("");
		expect(readFieldRule({ filename: "" }, CONTENT_FIELD_RULES.documentLabel)).toBe("Attached document");
		expect(readFieldRule({ content: [] }, CONTENT_FIELD_RULES.toolResult)).toBeUndefined();
	});

	it("内联媒体块在 inlineData 为空时回退到 file_data", () => {
		// Gemini 同一块里可能同时出现两种命名，空的那个不能挡住有内容的一个。
		const block = { inlineData: {}, file_data: { mimeType: "image/png", fileUri: "gs://x/y.png" } };

		expect(readFieldRule(block, CONTENT_FIELD_RULES.inlineMedia)).toEqual({
			mimeType: "image/png",
			fileUri: "gs://x/y.png",
		});
	});

	it("工具调用参数兼容 input、arguments 与嵌套 function.arguments", () => {
		expect(readFieldRule({ input: "git status" }, CONTENT_FIELD_RULES.toolArguments)).toBe("git status");
		expect(readFieldRule({ arguments: '{"a":1}' }, CONTENT_FIELD_RULES.toolArguments)).toBe('{"a":1}');
		expect(readFieldRule({ function: { arguments: "{}" } }, CONTENT_FIELD_RULES.toolArguments)).toBe("{}");
	});

	it("图片规则能从嵌套 source 与扁平字段两处取到来源和类型", () => {
		const block = { source: { data: "abc", media_type: "image/webp" } };

		expect(readFieldRule(block, CONTENT_FIELD_RULES.imageSource)).toBe("abc");
		expect(readFieldRule(block, CONTENT_FIELD_RULES.imageMimeType)).toBe("image/webp");
		expect(readFieldRule({ mimeType: "image/png" }, CONTENT_FIELD_RULES.imageMimeType)).toBe("image/png");
	});

	it("收集文本片段时跳过空片段与非文本项", () => {
		const segments = collectTextSegments([{ text: "第一段" }, { text: "" }, "第二段", null, { text: "第三段" }]);

		expect(segments).toEqual(["第一段", "第二段", "第三段"]);
	});
});
