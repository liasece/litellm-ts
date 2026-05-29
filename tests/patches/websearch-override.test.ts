/**
 * Patch 7: websearch_override_target_model 测试
 */
import { _applyWebSearchOverrideTargetModel, _isWebSearchTool } from "../../src/proxy/AnthropicMessagesEndpoint";

describe("_isWebSearchTool", () => {
	it("detects type: web_search", () => {
		expect(_isWebSearchTool({ type: "web_search" })).toBe(true);
	});

	it("detects type: web_search_20250305", () => {
		expect(_isWebSearchTool({ type: "web_search_20250305" })).toBe(true);
	});

	it("detects prefixed web_search_ types", () => {
		expect(_isWebSearchTool({ type: "web_search_preview" })).toBe(true);
	});

	it("detects name-based web_search tool", () => {
		expect(_isWebSearchTool({ name: "web_search" })).toBe(true);
	});

	it("detects function-wrapped web_search", () => {
		expect(_isWebSearchTool({ type: "function", function: { name: "web_search" } })).toBe(true);
	});

	it("rejects regular function tool", () => {
		expect(_isWebSearchTool({ type: "function", function: { name: "get_weather" } })).toBe(false);
	});

	it("rejects null/empty", () => {
		expect(_isWebSearchTool(null)).toBe(false);
		expect(_isWebSearchTool(undefined)).toBe(false);
		expect(_isWebSearchTool({})).toBe(false);
	});
});

describe("_applyWebSearchOverrideTargetModel", () => {
	const settings = { websearch_override_target_model: "glm-latest-anthropic" };

	it("rewrites model when all tools are web_search with tool_choice", () => {
		const data = {
			model: "claude-sonnet-4-6",
			tools: [{ type: "web_search" }],
			tool_choice: { type: "tool", name: "web_search" } as Record<string, unknown>,
		};
		_applyWebSearchOverrideTargetModel(data, settings);
		expect(data.model).toBe("glm-latest-anthropic");
	});

	it("does NOT rewrite when mixed tools", () => {
		const data = {
			model: "claude-sonnet-4-6",
			tools: [{ type: "web_search" }, { type: "function", function: { name: "read_file" } }],
			tool_choice: { type: "tool", name: "web_search" } as Record<string, unknown>,
		};
		_applyWebSearchOverrideTargetModel(data, settings);
		expect(data.model).toBe("claude-sonnet-4-6");
	});

	it("does NOT rewrite when no tools", () => {
		const data = {
			model: "claude-sonnet-4-6",
			tools: [],
			tool_choice: { type: "tool", name: "web_search" } as Record<string, unknown>,
		};
		_applyWebSearchOverrideTargetModel(data, settings);
		expect(data.model).toBe("claude-sonnet-4-6");
	});

	it("does NOT rewrite when missing tool_choice", () => {
		const data = { model: "claude-sonnet-4-6", tools: [{ type: "web_search" }] };
		_applyWebSearchOverrideTargetModel(data, settings);
		expect(data.model).toBe("claude-sonnet-4-6");
	});

	it("does NOT rewrite when tool_choice is not web_search", () => {
		const data = {
			model: "claude-sonnet-4-6",
			tools: [{ type: "web_search" }],
			tool_choice: { type: "auto" } as unknown as Record<string, unknown>,
		};
		_applyWebSearchOverrideTargetModel(data, settings);
		expect(data.model).toBe("claude-sonnet-4-6");
	});

	it("does NOT rewrite when no override target configured", () => {
		const data = {
			model: "claude-sonnet-4-6",
			tools: [{ type: "web_search" }],
			tool_choice: { type: "tool", name: "web_search" } as Record<string, unknown>,
		};
		_applyWebSearchOverrideTargetModel(data, {});
		expect(data.model).toBe("claude-sonnet-4-6");
	});
});
