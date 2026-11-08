import { describe, expect, it } from "vitest";
import { initialToolArguments, toolArgumentSchema, validateToolArguments } from "./PlaygroundToolArgumentsLogic";
describe("MCP structured tool arguments", () => {
	it("flattens the nested params form while preserving its wire wrapper and recursive defaults", () => {
		const tool = {
			name: "search",
			inputSchema: {
				type: "object",
				properties: {
					params: {
						type: "object",
						required: ["query"],
						properties: {
							query: { type: "string" },
							limit: { type: "integer", default: 3 },
							filters: { type: "object", properties: { active: { type: "boolean", default: true } } },
							paths: { type: "array", items: { type: "string", default: "/fixture" } },
						},
					},
				},
			},
		};
		const parsed = toolArgumentSchema(tool),
			initial = initialToolArguments(parsed.actual);
		expect(initial.limit).toBe(3);
		expect(JSON.parse(String(initial.filters))).toEqual({ active: true });
		expect(JSON.parse(String(initial.paths))).toEqual(["/fixture"]);
		const result = validateToolArguments({ ...initial, query: "fixture", limit: 3.8 }, tool);
		expect(result.errors).toEqual({});
		expect(result.data).toEqual({ params: { query: "fixture", limit: 3, filters: { active: true }, paths: ["/fixture"] } });
	});
	it("blocks missing required and malformed JSON before a tool call", () => {
		const tool = {
			name: "write",
			inputSchema: {
				type: "object",
				required: ["name", "payload"],
				properties: { name: { type: "string" }, payload: { type: "object" }, items: { type: "array" } },
			},
		};
		expect(validateToolArguments({ name: "", payload: "[]", items: "bad" }, tool).errors).toEqual({
			name: "Please enter name",
			payload: "Please enter a JSON object",
			items: "Invalid JSON",
		});
	});
});
