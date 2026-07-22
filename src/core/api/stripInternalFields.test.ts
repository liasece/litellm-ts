/**
 * stripInternalFields 单元测试
 *
 * 覆盖响应出口内部字段剥离规则：
 * - 顶层 `_` 前缀键被剥离，协议字段保留
 * - 嵌套对象的 `_` 前缀键不剥离（仅顶层）
 * - 无内部字段时原样返回（零拷贝）
 * - 非普通对象（null/数组/原始值）原样返回
 */

import { stripInternalFields } from "./stripInternalFields";

describe("stripInternalFields", () => {
	it("剥离顶层 `_` 前缀内部字段，保留协议字段", () => {
		const result = {
			id: "chatcmpl-1",
			model: "gpt-4",
			choices: [],
			_hidden_params: { provider_specific_fields: {} },
			_provider: "deployment-a",
			_fallbackDepth: 0,
			_providerHeaders: { "x-request-id": "r1" },
			_customCostPerToken: true,
		};
		expect(stripInternalFields(result)).toEqual({ id: "chatcmpl-1", model: "gpt-4", choices: [] });
	});

	it("嵌套对象的 `_` 前缀键不剥离", () => {
		const result = { usage: { _internal: 1, total_tokens: 3 }, _provider: "d" };
		expect(stripInternalFields(result)).toEqual({ usage: { _internal: 1, total_tokens: 3 } });
	});

	it("无内部字段时原样返回同一引用（零拷贝）", () => {
		const result = { id: "chatcmpl-2", model: "gpt-4" };
		expect(stripInternalFields(result)).toBe(result);
	});

	it("非普通对象原样返回", () => {
		expect(stripInternalFields(null)).toBe(null);
		expect(stripInternalFields([1, 2])).toEqual([1, 2]);
		expect(stripInternalFields("text")).toBe("text");
		expect(stripInternalFields(42)).toBe(42);
	});
});
