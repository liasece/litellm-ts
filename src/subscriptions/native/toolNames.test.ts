/**
 * 工具名归一化与响应还原测试。
 */

import { normalizeToolNames, restoreToolNames } from "./toolNames";

it("超长工具名被截断且能还原到响应", () => {
	const original = "mcp__server__" + "x".repeat(120);
	const body: Record<string, unknown> = {
		tools: [{ type: "function", function: { name: original, parameters: { type: "object" } } }],
		input: [{ type: "function_call", call_id: "call-1", name: original, arguments: "{}" }],
	};
	const mapping = normalizeToolNames(body, 64);
	const safe = (body["tools"] as Array<Record<string, unknown>>)[0]?.["function"] as Record<string, unknown>;
	expect(typeof safe["name"]).toBe("string");
	expect(String(safe["name"]).length).toBeLessThanOrEqual(64);
	expect(String(safe["name"])).toContain("_");

	const response: Record<string, unknown> = { output: [{ type: "function_call", name: safe["name"] }] };
	restoreToolNames(mapping, response);
	expect((response["output"] as Array<Record<string, unknown>>)[0]?.["name"]).toBe(original);
});

it("合法短工具名不产生映射", () => {
	const body: Record<string, unknown> = {
		tools: [{ type: "function", function: { name: "lookup" } }],
	};
	expect(normalizeToolNames(body, 64)).toBeUndefined();
});

it("冲突的安全名使用哈希区分", () => {
	const body: Record<string, unknown> = {
		tools: [
			{ type: "function", function: { name: "a".repeat(70) + "x" } },
			{ type: "function", function: { name: "a".repeat(70) + "y" } },
		],
	};
	const mapping = normalizeToolNames(body, 64);
	const names = (body["tools"] as Array<Record<string, unknown>>).map(
		(tool) => (tool["function"] as Record<string, unknown>)["name"],
	);
	expect(new Set(names).size).toBe(2);
	expect(mapping?.size).toBe(2);
});
